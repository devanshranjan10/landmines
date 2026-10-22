// landmine.tech edge: send http:// and www. to https://landmine.tech, serve everything else from static assets.
const HOST = 'landmine.tech';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' || url.hostname === `www.${HOST}`) {
      url.protocol = 'https:';
      url.hostname = HOST;
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
