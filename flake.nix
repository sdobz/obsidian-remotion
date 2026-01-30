{
  description = "Daily Notes or Screaming Into the Void";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, utils }: (utils.lib.eachSystem ["x86_64-linux" "x86_64-darwin" ] (system: let
    pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
    fonts = [ pkgs.noto-fonts-color-emoji ];

    # 2. Generate a valid fonts.conf that includes these fonts
    #    This automatically handles including the default system configuration
    #    so you don't lose your normal fonts.
    fontsConf = pkgs.makeFontsConf {
      fontDirectories = fonts;
    };
    
  in rec {
    packages = {
    };

    devShell = pkgs.mkShell {
      buildInputs = [
        # GUI/editor/runtime
        pkgs.obsidian

        # fonts used by the vault/UI
        pkgs.noto-fonts-color-emoji

        # aissastant agent
        pkgs.gemini-cli-bin

        # node toolchain for plugin dev
        pkgs.nodejs_22
      ];

      # Helpful environment hints and PATH adjustments
      shellHook = ''
        export FONTCONFIG_FILE="${fontsConf}"

        echo "obsidian-remotion dev-shell: node $(node --version 2>/dev/null || echo n/a)"
        
        if [ -d ./node_modules/.bin ]; then
          export PATH="$PWD/node_modules/.bin:$PATH"
        fi
        
        if [ -f ./package.json ] && [ ! -d ./node_modules ]; then
          echo "Run 'npm install' to install plugin dev dependencies."
        fi
      '';
    };
  }));
}
