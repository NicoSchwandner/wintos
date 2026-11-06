// The app's own user agent as plain Chrome: without the Electron and app tokens.
export const chromeUserAgent = (ua: string) => ua.replace(/ Electron\/\S+/, "").replace(/ Wave(\(Dev\))?\/\S+/, "");
