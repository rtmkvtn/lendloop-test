type Activity = { label: string; detail?: string };

// The detail goes after the time, so a line reads "… failed 2 days ago · retrying".
export function activityText(activity: Activity, when?: string) {
  const main = when ? `${activity.label} ${when}` : activity.label;
  return activity.detail ? `${main} · ${activity.detail}` : main;
}
