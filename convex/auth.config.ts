import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Set by `npm run setup` before the first push that includes this file.
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
