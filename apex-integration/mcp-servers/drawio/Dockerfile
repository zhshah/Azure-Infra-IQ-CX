FROM denoland/deno:2.3.3

WORKDIR /app

# Copy drawio MCP server source from APEX repo
COPY . .

# Cache dependencies using the actual entry point
RUN deno cache src/index.ts

ENV HTTP_PORT=3001
ENV TRANSPORT=http
EXPOSE 3001

# Run with HTTP transport using proper Deno permissions
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "src/index.ts"]
