

export const cliFlags = {
  publish: true,
  yes: false,
  verbose: false
};


export function setCliFlags(options: { publish: boolean; yes: boolean; verbose: boolean }) {
  cliFlags.publish = options.publish;
  cliFlags.yes = options.yes;
  cliFlags.verbose = options.verbose;
}
