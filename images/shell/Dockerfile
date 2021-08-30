# kube-ps1 ------------------------------------------------------------------
FROM shopstic/curl-tar-unzip:1.0.1 as kube-ps1

ENV KUBE_PS1_VERSION "0.7.0"

RUN \
  curl -Lo /root/kube-ps1.sh https://raw.githubusercontent.com/jonmosco/kube-ps1/v${KUBE_PS1_VERSION}/kube-ps1.sh

FROM ubuntu:20.04

ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
ENV TERM=xterm-256color

# `ca-certificates` is needed to work with Github packages TLS certificate
# `unzip` is needed for `deno upgrade ...` and `deno compile --lite ...` to extract its downloaded archive
RUN \
  apt-get update && \
  apt-get install -y curl ca-certificates unzip

COPY --from=shopstic/bin-kubectl:1.21.4 / /
COPY --from=shopstic/bin-helm:3.6.3  / /
COPY --from=shopstic/bin-deno:1.13.2 / /
COPY --from=shopstic/bin-sops:3.7.1 / /
COPY --from=shopstic/bin-yq:4.12.1 / /
COPY --from=shopstic/bin-nodejs:14.17.5 / /
COPY --from=kube-ps1 /root/kube-ps1.sh /root/kube-ps1.sh

ENV PATH="/root/.deno/bin:$PATH"

ENV JSON_SCHEMA_TO_TYPESCRIPT_VERSION "10.1.4"

RUN \
  npm install -g json-schema-to-typescript@${JSON_SCHEMA_TO_TYPESCRIPT_VERSION}

COPY ./.profile /root/.profile

RUN \
  printf "\n%s\n" "export PATH=\"${PATH}\"" >> /root/.profile
