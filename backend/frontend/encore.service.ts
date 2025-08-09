
import { api } from "encore.dev/api";
import { Service } from "encore.dev/service";

export default new Service("frontend");

export const assets = api.static({
  path: "/frontend/*path",
  expose: true,
  dir: "./dist",
  notFound: "./dist/index.html",
  notFoundStatus: 200,
});
