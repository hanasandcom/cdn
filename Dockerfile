# Uses latest node alpine image for apk package manager
FROM oven/bun:alpine

# Install dependencies
RUN apk add --no-cache varnish

# Sets the working directory
WORKDIR /usr/src/app
ARG HANASAND_RELEASE_COMMIT=unknown
ENV HANASAND_RELEASE_COMMIT=$HANASAND_RELEASE_COMMIT

# Copies contents
COPY . .
COPY ./entrypoint.sh /usr/src/app/entrypoint.sh
COPY ./default.vcl /etc/varnish/default.vcl
COPY package.json bun.lock bunfig.toml ./

# Adds execute permissions to entrypoint script
RUN chmod +x /usr/src/app/entrypoint.sh

# Installs required dependencies
RUN bun install --frozen-lockfile
RUN bun run build:auth-client

# Expose API port
EXPOSE 8080

# Start the application
CMD ["/usr/src/app/entrypoint.sh"]
