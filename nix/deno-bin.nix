{ autoPatchelfHook, fetchurl, stdenv, unzip }:

let
  archMap = {
    x86_64-linux = "x86_64-unknown-linux-gnu";
    x86_64-darwin = "x86_64-apple-darwin";
    aarch64-darwin = "aarch64-apple-darwin";
  };
  shaMap = {
    x86_64-darwin = "3b1a43def350a723a15f60e03cd532ff1ab340578b7f5694be18d9794bc5c2a6";
    x86_64-linux = "416415b4751443d33ab085b9d98e361920da430068bf72c84844923909cb2441";
    aarch64-darwin = "6bf8c067d3becd967ff89bd05666864eebcf6d6841e3d1ab9beea9d4979aabf3";
  };
in
stdenv.mkDerivation rec {
  name = "deno-bin-${version}";
  version = "1.14.3";

  src = fetchurl {
    url = "https://github.com/denoland/deno/releases/download/v1.14.3/deno-${archMap.${stdenv.hostPlatform.system}}.zip";
    sha256 = shaMap.${stdenv.hostPlatform.system};
  };

  nativeBuildInputs = [
    autoPatchelfHook
    unzip
  ];

  unpackPhase = ''
    unzip $src
  '';

  installPhase = ''
    install -m755 -D deno $out/bin/deno
  '';

  meta = with stdenv.lib; {
    homepage = https://deno.land;
    description = "A secure runtime for JavaScript and TypeScript";
    platforms = [ "x86_64-linux" "x86_64-darwin" "aarch64-darwin" ];
  };
}
