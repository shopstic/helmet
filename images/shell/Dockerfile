FROM shopstic/bin-kubectl:1.20.4 as bin-kubectl
FROM shopstic/bin-deno:1.9.2 as bin-deno
FROM shopstic/bin-helm:3.5.3 as bin-helm
FROM shopstic/bin-yq:4.6.3 as bin-yq
FROM shopstic/bin-sops:3.7.1 as bin-sops
FROM shopstic/bin-nodejs:14.16.1 as bin-nodejs

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
  apt-get install -y ca-certificates unzip

COPY --from=bin-kubectl / /
COPY --from=bin-helm / /
COPY --from=bin-deno / /
COPY --from=bin-sops / /
COPY --from=bin-yq / /
COPY --from=bin-nodejs / /
COPY --from=kube-ps1 /root/kube-ps1.sh /root/kube-ps1.sh

ENV PATH="/root/.deno/bin:$PATH"

ENV JSON_SCHEMA_TO_TYPESCRIPT_VERSION "10.1.4"

RUN \
  npm install -g json-schema-to-typescript@${JSON_SCHEMA_TO_TYPESCRIPT_VERSION}

COPY ./.profile /root/.profile

RUN \
  printf "\n%s\n" "export PATH=\"${PATH}\"" >> /root/.profile
