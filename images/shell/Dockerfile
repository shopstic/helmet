FROM shopstic/bin-kubectl:1.20.4 as bin-kubectl
FROM shopstic/bin-deno:1.9.0 as bin-deno
FROM shopstic/bin-helm:3.5.3 as bin-helm
FROM shopstic/bin-yq:4.6.3 as bin-yq


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
COPY --from=bin-yq / /
COPY --from=kube-ps1 /root/kube-ps1.sh /root/kube-ps1.sh

ENV PATH="/root/.deno/bin:$PATH"

COPY ./.profile /root/.profile

RUN \
  printf "\n%s\n" "export PATH=\"${PATH}\"" >> /root/.profile
