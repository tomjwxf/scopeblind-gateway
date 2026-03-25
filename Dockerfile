FROM node:22-alpine

WORKDIR /app

RUN npm install -g protect-mcp@latest

# protect-mcp is a stdio proxy that wraps other MCP servers.
# In demo mode, it wraps a built-in sample server to demonstrate
# shadow-mode logging, per-tool policies, and optional signed receipts.
ENTRYPOINT ["protect-mcp"]
