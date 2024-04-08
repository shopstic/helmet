{ name
, src
, stdenv
, deno
, writeShellScriptBin
}:
let
  script = ./build.ts;
  build = stdenv.mkDerivation
    {
      inherit src;
      name = "${name}-build";
      nativeBuildInputs = [ deno ];
      __noChroot = true;
      phases = [ "unpackPhase" "installPhase" ];
      installPhase =
        ''
          export DENO_DIR=$(mktemp -d)
          deno run -A --check "${script}" $out
        '';
    };
in
writeShellScriptBin name ''
  exec deno run -A --no-config --no-lock --no-prompt "${build}/src/helmet.js" "$@"
''
