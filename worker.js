export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      return Response.redirect("https://blog.gleam.ch/", 301);
    }
    return response;
  },
};
