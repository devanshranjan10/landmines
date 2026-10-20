import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
export const PACKAGE_NAME: string = pkg.name;
export const USER_AGENT = `${PACKAGE_NAME}/${VERSION} (+https://www.npmjs.com/package/${PACKAGE_NAME})`;
