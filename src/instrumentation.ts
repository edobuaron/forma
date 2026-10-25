// Server components bucket workouts into days and weeks. Serverless hosts run in UTC, so set
// APP_TIMEZONE (e.g. "Europe/Rome") to make "today", week starts and the calendar match your clock.
export function register() {
  if (process.env.APP_TIMEZONE && process.env.NEXT_RUNTIME === "nodejs") {
    process.env.TZ = process.env.APP_TIMEZONE;
  }
}
