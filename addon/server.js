const addon = require("./index.js");
const analyticsMiddleware = require("./middleware/analytics.middleware");
const analytics = require("./utils/analytics");

// Apply middleware (if addon is an Express app)
addon.use(analyticsMiddleware());

// Define the `/configure` route
addon.get("/configure", (req, res) => {
  analytics.trackInstall({
    language: req.query.language || "en",
    catalogs: req.query.catalogs ? req.query.catalogs.split(",") : [],
    integrations: req.query.integrations ? req.query.integrations.split(",") : [],
  });
  res.status(200).send("Configuration tracked successfully.");
});

// Export for serverless deployment (Vercel, AWS Lambda, etc.)
module.exports = addon;