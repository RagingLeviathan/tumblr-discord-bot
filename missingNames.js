const fs = require("fs");

const latestFile = process.argv[2] || "followers02-11-2026 21.json";
const previousFile = process.argv[3] || "followers22-09-2026 15.json";
const outputFile = process.argv[4] || "followers_diff.json";

if (!fs.existsSync(latestFile) || !fs.existsSync(previousFile)) {
  console.error(
    "Usage: node missingNames.js <latestFile.json> <previousFile.json> [outputFile.json]",
  );
  process.exit(1);
}

function readFollowers(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toNameSet(followers) {
  return new Set(
    followers
      .map((follower) => follower && follower.name)
      .filter((name) => typeof name === "string" && name.trim().length > 0),
  );
}

function toTumblrUrl(username) {
  return `https://www.tumblr.com/${username}`;
}

const latestData = readFollowers(latestFile);
const previousData = readFollowers(previousFile);

const latestNames = toNameSet(latestData);
const previousNames = toNameSet(previousData);

// "New" means present in latest scrape but not in previous scrape.
const newFollowers = [...latestNames]
  .filter((name) => !previousNames.has(name))
  .sort();

// Present in previous scrape but missing from latest scrape.
// These are likely unfollowers, deactivated accounts, or renamed accounts.
const missingFromLatest = [...previousNames]
  .filter((name) => !latestNames.has(name))
  .sort();

const newFollowerUrls = newFollowers.map(toTumblrUrl);
const missingFromLatestUrls = missingFromLatest.map(toTumblrUrl);

const diffReport = {
  latestFile,
  previousFile,
  summary: {
    latestUniqueCount: latestNames.size,
    previousUniqueCount: previousNames.size,
    newFollowersCount: newFollowers.length,
    missingFromLatestCount: missingFromLatest.length,
  },
  newFollowers: newFollowerUrls,
  missingFromLatest: missingFromLatestUrls,
};

console.log(`New followers in ${latestFile} (not in ${previousFile}):`);
if (newFollowers.length === 0) {
  console.log("None");
} else {
  newFollowerUrls.forEach((url) => console.log(url));
}

console.log(
  `\nMissing from ${latestFile} but present in ${previousFile} (possible unfollows/name changes):`,
);
if (missingFromLatest.length === 0) {
  console.log("None");
} else {
  missingFromLatestUrls.forEach((url) => console.log(url));
}

fs.writeFileSync(outputFile, JSON.stringify(diffReport, null, 2));
console.log(`\nSaved diff report to ${outputFile}`);
