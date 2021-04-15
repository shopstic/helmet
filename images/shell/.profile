#!/usr/bin/env bash
export KUBE_PS1_ENABLED=on
export KUBE_PS1_CTX_COLOR=white
export KUBE_PS1_SYMBOL_COLOR=cyan
source /root/kube-ps1.sh
PS1='[\u@\h \W $(kube_ps1)]\$ '

if ! ls /app >/dev/null 2>&1; then
  ln -s "${PWD}" /app
fi

export SAVEHIST=1000
export HISTFILE=/app/.shell-history
