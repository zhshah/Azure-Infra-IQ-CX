FROM python:3.13-slim

WORKDIR /app

# Copy azure-pricing MCP server source
COPY . .

# Install the package (uses pyproject.toml for dependencies)
RUN pip install --no-cache-dir -e .

ENV PORT=3002
EXPOSE 3002

# Run as HTTP MCP server using the built-in HTTP transport
CMD ["python", "-m", "azure_pricing_mcp", "--transport", "http", "--host", "0.0.0.0", "--port", "3002"]
