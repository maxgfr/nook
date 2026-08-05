# Nook, served from your own machine.
#
# The published site and this image are the same files: the security policy
# travels inside the HTML, not in a server header, so the promise holds
# identically whoever is serving it. Running this only changes where the
# application itself comes from — which, for a program whose whole claim is
# that nothing leaves your machine, is a reasonable thing to want.
#
#   docker build -t nook .
#   docker run --rm -p 8080:8080 nook
#
# Then open http://localhost:8080.

# --- Build ------------------------------------------------------------------

FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

# The manifest first, so a change to the source does not re-resolve every
# dependency. `--frozen-lockfile` makes the build fail rather than quietly
# resolve something the lockfile did not describe.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# GitHub Pages serves the site under `/nook/`; a container serves it at the
# root. This is the one line that differs, and the application derives
# everything else from it.
ARG BASE=/
ENV BASE=$BASE
RUN pnpm build

# The same guard CI runs, against the very bundle this image will serve. An
# image that shipped a build without the policy would look identical from the
# outside, which is exactly the failure worth refusing here.
RUN pnpm check:network

# --- Serve ------------------------------------------------------------------

FROM nginx:1.27-alpine AS serve

# nginx's stock image writes its pid and caches under /var, which a read-only
# root filesystem forbids; this config keeps it to /tmp so the container can be
# run with `--read-only` for anyone who wants to.
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Unprivileged: nothing here needs to bind a low port or write to the image.
USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --spider -q http://127.0.0.1:8080/ || exit 1
