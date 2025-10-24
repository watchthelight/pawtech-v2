// Configuration constants
export const TRACE_INTERACTIONS = process.env.TRACE_INTERACTIONS === "1";
export const OWNER_IDS = process.env.OWNER_IDS
  ? process.env.OWNER_IDS.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  : [];
