{ pkgs ? import <nixpkgs> { } }:
with pkgs;
let
  nodePkgs = import ./node2nix-default.nix { pkgs = pkgs; };
in
rec {
  runtimeInputs = [ kubectl yq sops kubernetes-helm nodePkgs."json-schema-to-typescript-10.1.5" ];
  derivation = mkShell rec {
    deno-bin = callPackage ./deno-bin.nix { };
    buildInputs = [
      nixpkgs-fmt
      deno-bin
      # k9s
      # kubectx
      # terraform
      # awscli2
      # cachix
      # stern
      # jq
      # parallel
      nodePackages.node2nix
    ] ++ runtimeInputs;
  };
}
