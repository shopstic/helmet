{ npmlock2nix
, runCommandLocal
}:
let
  mod = npmlock2nix.node_modules {
    src = ./src;
  };
in
runCommandLocal "json2ts" { } ''
  mkdir -p $out/bin
  ln -s "${mod}/bin/json2ts" $out/bin/json2ts
''
