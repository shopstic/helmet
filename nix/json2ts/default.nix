{ npmlock2nix
, runCommandNoCC
}:
let
  mod = npmlock2nix.node_modules {
    src = ./src;
  };
in
runCommandNoCC "json2ts" { } ''
  mkdir -p $out/bin
  ln -s "${mod}/bin/json2ts" $out/bin/json2ts
''
