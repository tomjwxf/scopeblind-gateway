/**
 * ScopeBlind Gateway — Cloudflare Worker Reverse Proxy
 *
 * Sits in front of your API. Verifies cryptographic proofs at the edge.
 * Start in shadow mode (measure only), then flip to enforcement when ready.
 *
 * Shadow mode: logs what WOULD be blocked, forwards everything to origin.
 * Enforce mode: blocks requests that fail verification, only forwards valid traffic.
 */

export interface Env {
  ORIGIN_URL: string;
  SCOPEBLIND_VERIFIER_URL: string; // e.g. https://api.scopeblind.com/v/abc123/verify — includes tenant ID, no API key needed
  SHADOW_MODE: string;       // "true" | "false"
  PROTECTED_METHODS: string; // comma-separated: "POST,PUT,DELETE,PATCH"
  FALLBACK_MODE: string;     // "open" | "closed"
}

interface VerifyResult {
  verified: boolean;
  remaining?: number;
  error?: string;
  receipt?: any;
}

// Shadow mode telemetry — logged to console (visible in wrangler tail / Workers Logs)
function logShadow(action: string, data: Record<string, any>) {
  console.log(JSON.stringify({
    _scopeblind: true,
    action,
    ts: new Date().toISOString(),
    ...data,
  }));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isShadow = env.SHADOW_MODE === "true";
    const protectedMethods = (env.PROTECTED_METHODS || "POST,PUT,DELETE,PATCH")
      .split(",")
      .map((m) => m.trim().toUpperCase());

    // ---------------------------------------------------------------
    // 1. CORS Preflight
    // ---------------------------------------------------------------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Proof, X-ScopeBlind-Proof",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // ---------------------------------------------------------------
    // 2. Health check (for monitoring)
    // ---------------------------------------------------------------
    if (url.pathname === "/_scopeblind/health") {
      return Response.json({
        ok: true,
        mode: isShadow ? "shadow" : "enforce",
        origin: env.ORIGIN_URL,
        verifier: env.SCOPEBLIND_VERIFIER_URL,
      });
    }

    // ---------------------------------------------------------------
    // 3. Check if this request needs protection
    // ---------------------------------------------------------------
    const needsProof = protectedMethods.includes(request.method);
    const proof =
      request.headers.get("X-Proof") ||
      request.headers.get("X-ScopeBlind-Proof");

    // Unprotected methods (e.g., GET) — forward directly
    if (!needsProof) {
      return forwardToOrigin(request, env, url, {
        "X-ScopeBlind-Mode": isShadow ? "shadow" : "enforce",
        "X-ScopeBlind-Verified": "skipped",
      });
    }

    // ---------------------------------------------------------------
    // 4. Protected method — verify proof
    // ---------------------------------------------------------------

    // No proof provided
    if (!proof) {
      logShadow("no_proof", {
        method: request.method,
        path: url.pathname,
        ip: request.headers.get("CF-Connecting-IP") || "unknown",
      });

      if (isShadow) {
        // Shadow: log and forward anyway
        return forwardToOrigin(request, env, url, {
          "X-ScopeBlind-Mode": "shadow",
          "X-ScopeBlind-Verified": "missing",
          "X-ScopeBlind-Action": "would-block",
        });
      } else {
        // Enforce: reject
        return Response.json(
          {
            error: "proof_required",
            message:
              "This endpoint requires a ScopeBlind proof. Include it in the X-Proof header.",
          },
          {
            status: 401,
            headers: corsHeaders(request),
          }
        );
      }
    }

    // Proof provided — verify with ScopeBlind
    let verifyResult: VerifyResult;
    try {
      const verifyRes = await fetch(env.SCOPEBLIND_VERIFIER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: request.headers.get("Origin") || url.origin,
        },
        body: proof, // Already JSON string from the header
      });

      verifyResult = (await verifyRes.json()) as VerifyResult;

      if (!verifyRes.ok || !verifyResult.verified) {
        // Verification failed (quota exceeded, invalid proof, etc.)
        logShadow("verify_failed", {
          method: request.method,
          path: url.pathname,
          status: verifyRes.status,
          error: verifyResult.error || "unknown",
          ip: request.headers.get("CF-Connecting-IP") || "unknown",
        });

        if (isShadow) {
          return forwardToOrigin(request, env, url, {
            "X-ScopeBlind-Mode": "shadow",
            "X-ScopeBlind-Verified": "failed",
            "X-ScopeBlind-Action": "would-block",
            "X-ScopeBlind-Error": verifyResult.error || "verification_failed",
          });
        } else {
          return Response.json(
            {
              error: "rate_limited",
              message: "Request quota exceeded or proof invalid.",
              details: verifyResult.error,
            },
            {
              status: 429,
              headers: corsHeaders(request),
            }
          );
        }
      }
    } catch (e) {
      // Verifier unreachable
      logShadow("verifier_error", {
        method: request.method,
        path: url.pathname,
        error: e instanceof Error ? e.message : "unknown",
      });

      if (env.FALLBACK_MODE === "closed" && !isShadow) {
        return Response.json(
          {
            error: "verification_unavailable",
            message: "Unable to verify request. Try again later.",
          },
          {
            status: 503,
            headers: corsHeaders(request),
          }
        );
      }

      // Fail open (or shadow mode) — forward anyway
      return forwardToOrigin(request, env, url, {
        "X-ScopeBlind-Mode": isShadow ? "shadow" : "enforce",
        "X-ScopeBlind-Verified": "error",
        "X-ScopeBlind-Action": "fallback-allow",
      });
    }

    // ---------------------------------------------------------------
    // 5. Verification passed — forward to origin
    // ---------------------------------------------------------------
    logShadow("verified", {
      method: request.method,
      path: url.pathname,
      remaining: verifyResult.remaining,
    });

    return forwardToOrigin(request, env, url, {
      "X-ScopeBlind-Mode": isShadow ? "shadow" : "enforce",
      "X-ScopeBlind-Verified": "true",
      "X-ScopeBlind-Remaining": String(verifyResult.remaining ?? ""),
    });
  },
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

async function forwardToOrigin(
  request: Request,
  env: Env,
  url: URL,
  extraHeaders: Record<string, string>
): Promise<Response> {
  const origin = new URL(env.ORIGIN_URL);
  url.hostname = origin.hostname;
  url.protocol = origin.protocol;
  url.port = origin.port;

  const headers = new Headers(request.headers);
  // Add ScopeBlind metadata headers for the origin to read
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v) headers.set(k, v);
  }
  // Remove proof header before forwarding (origin doesn't need it)
  headers.delete("X-Proof");
  headers.delete("X-ScopeBlind-Proof");

  try {
    const response = await fetch(
      new Request(url.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "follow",
      })
    );

    const res = new Response(response.body, response);
    // Add CORS headers
    res.headers.set(
      "Access-Control-Allow-Origin",
      request.headers.get("Origin") || "*"
    );
    return res;
  } catch (e) {
    return Response.json(
      { error: "upstream_error", message: "Failed to reach backend." },
      {
        status: 502,
        headers: corsHeaders(request),
      }
    );
  }
}

function corsHeaders(request: Request): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
  };
}
