import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import type { WorkerEnv } from "../alchemy.run";

const handleStartRequest = createStartHandler(defaultStreamHandler);

export default {
  // Start's second parameter is its own request options, not the Worker env,
  // so the Worker's handler can't be passed through unwrapped.
  fetch(request) {
    return handleStartRequest(request);
  },

  async scheduled(controller) {
    console.info("Scheduled event", { cron: controller.cron, time: controller.scheduledTime });
  },
} satisfies ExportedHandler<WorkerEnv>;
