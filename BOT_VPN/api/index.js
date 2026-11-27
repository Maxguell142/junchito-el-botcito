const expressApp = require('../src');
const { stringify } = require('node:querystring');

module.exports = (req, res) => {
  const forwardedPath = req.query && req.query.__route;
  if (typeof forwardedPath === 'string' && forwardedPath.startsWith('/')) {
    const query = { ...req.query };
    delete query.__route;
    const suffix = stringify(query);
    req.url = forwardedPath + (suffix ? `?${suffix}` : '');
  }
  return expressApp(req, res);
};
