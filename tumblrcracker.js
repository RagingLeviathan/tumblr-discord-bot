//tumblrcracker v2 - multiuser dynamic implementation
require("dotenv").config();
const axios = require("axios");
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");
const fs = require("fs");
const { fetchFollowersWithToken } = require("./fetchFollowersWithToken");

const blogName = process.env.BLOG_NAME;
// OAuth configuration
const oauth = OAuth({
  consumer: {
    key: process.env.CONSUMER_KEY,
    secret: process.env.CONSUMER_SECRET,
  },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

// OAuth token (if available)
const token = {
  key: process.env.OAUTH_KEY,
  secret: process.env.OAUTH_SECRET,
};
const REQUESTS_PER_MINUTE = 300;
const REQUEST_INTERVAL = 60000 / REQUESTS_PER_MINUTE; // Calculate interval in milliseconds

// Function to fetch followers with pagination
// Function to fetch followers with pagination
async function fetchFollowers(blogName, limit, offset = 0) {
  try {
    const apiUrl = `https://api.tumblr.com/v2/blog/${blogName}/followers`;
    const queryParams = {
      limit,
      offset,
    };
    const request_data = {
      url: `${apiUrl}?${new URLSearchParams(queryParams)}`,
      method: "GET",
    };
    const headers = oauth.toHeader(oauth.authorize(request_data, token));
    const response = await axios.get(request_data.url, { headers });
    return response.data.response;
  } catch (error) {
    console.log("Response headers:", error.response.headers); // Log the headers

    if (error.response && error.response.status === 429) {
      const retryAfter =
        error.response.headers["x-ratelimit-perhour-reset"] || 60; // Default to 60 seconds if not specified
      console.log(
        `Rate limit exceeded. Retrying after ${retryAfter} seconds... but this is tumblr api being wrong, so we'll try again in a minute.`
      );
      // await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      await new Promise((resolve) => setTimeout(resolve, 60000));
      return fetchFollowers(blogName, limit, offset); // Retry the request
    }

    throw new Error(
      `Failed to fetch followers from Tumblr API: ${error.message}`
    );
  }
}

// Function to fetch all followers
async function fetchAllFollowers(blogName, offset, total_users) {
  try {
    let allFollowers = [];
    let remainingUsers = total_users; // Store the remaining users separately

    while (remainingUsers > 0) {
      // Adjust the limit based on the remaining users
      let limit = remainingUsers <= 20 ? remainingUsers : 20;

      const response = await fetchFollowers(blogName, limit, offset);
      const users = response.users;
      allFollowers = allFollowers.concat(users);
      offset += users.length; // Adjust offset based on the number of fetched users
      remainingUsers -= users.length; // Update the remaining users count
      console.log(
        `Fetched ${users.length} followers. Remaining: ${remainingUsers}, limit: ${limit}, offset: ${offset}`
      );

      // Add delay to limit the number of requests per minute
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL));

      // Check if there are no more remaining followers
      if (remainingUsers <= 0) {
        console.log("All followers fetched.");
        break; // Exit the loop
      }
    }
    return allFollowers;
  } catch (error) {
    console.error("Failed to fetch all followers:", error.message);
    if (error.response) {
      console.error("Response headers:", error.response.headers); // Log the headers
    }
    throw new Error(`Failed to fetch all followers: ${error.message}`);
  }
}

// Function to convert Unix timestamp to real date
function convertUnixToDate(unixTimestamp) {
  return new Date(unixTimestamp * 1000); // Multiply by 1000 to convert seconds to milliseconds
}

// Reload followers JSON file, convert Unix timestamps to real dates, and overwrite the file
function reloadAndConvertJSON(filePath) {
  const currentDate = new Date();
  try {
    // Read the JSON file
    const jsonData = fs.readFileSync(filePath, "utf8");

    //console.log(jsonData);

    // Check if JSON data is empty or not in a valid JSON format
    if (!jsonData.trim()) {
      console.log("JSON file is empty.");
      return;
    }

    let followers = [];
    try {
      // Parse JSON data
      followers = JSON.parse(jsonData);
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError.message);
      return;
    }

    // Iterate through followers array and convert Unix timestamps to real dates
    followers.forEach((follower) => {
      // if (follower.updated) {
      //     follower.updated = convertUnixToDate(follower.updated);
      // }
      follower.lastChecked = currentDate;
    });

    // Convert followers array back to JSON
    const updatedJsonData = JSON.stringify(followers, null, 2);

    // Overwrite the JSON file with the updated data
    fs.writeFileSync("followersParsed.json", updatedJsonData);

    console.log("JSON file updated successfully");
  } catch (error) {
    console.error("Error reloading and converting JSON file:", error);
  }
}

// Function to get the current date and time in the format "dd-mm-yyyy hh:mm:ss:ms"
function getCurrentDate() {
  const currentDate = new Date();
  const day = String(currentDate.getDate()).padStart(2, "0");
  const month = String(currentDate.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const year = currentDate.getFullYear();
  const hours = String(currentDate.getHours()).padStart(2, "0");
  const minutes = String(currentDate.getMinutes()).padStart(2, "0");
  const seconds = String(currentDate.getSeconds()).padStart(2, "0");
  const milliseconds = String(currentDate.getMilliseconds()).padStart(3, "0");
  //return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}:${milliseconds}`;
  return `${day}-${month}-${year} ${hours}`;
}

// async function main(accessToken) {
//     try {
//         const currentDate = getCurrentDate();
//         //getting count of followers
//        const thing = await fetchFollowers(blogName, limit = 2000, offset = 0);
//         console.log(thing);
//         console.log(thing.total_users);
//         const userCount = thing.total_users;
//         //the business
//         const followers = await fetchAllFollowers(blogName, offset, userCount);
//         const jsonData = JSON.stringify(followers, null, 2);
//         fs.writeFile('followers' + currentDate + '.json', jsonData, err => {
//             if (err) {
//                 console.error('Error writing JSON to file:', err);
//                 return { data: null, success: false, error: err };

//             } else {
//                 console.log('JSON data saved to followers.json');
//                 return { data: jsonData, success: true, error: null };

//             }
//         });

//       //  reloadAndConvertJSON('followers.json');
//     } catch (error) {
//         console.error(error.message, error);
//         return error;
//     }
// }

//v2 main
// async function main(blogName, accessToken) {
//   try {
//     const currentDate = getCurrentDate();
//     const thing = await fetchFollowersWithToken(
//       blogName,
//       accessToken,
//       (limit = 2000),
//       (offset = 0)
//     );
//     console.log(thing);
//     console.log(thing.total_users);
//     const userCount = thing.total_users;
//     //the business
//     const followers = await fetchAllFollowers(blogName, offset, userCount);
//     const jsonData = JSON.stringify(followers, null, 2);
//     fs.writeFile("followers" + currentDate + ".json", jsonData, (err) => {
//       if (err) {
//         console.error("Error writing JSON to file:", err);
//         return { data: null, success: false, error: err };
//       } else {
//         console.log("JSON data saved to followers.json");
//         return { data: jsonData, success: true, error: null };
//       }
//     });
//   } catch (error) {
//     console.error(error.message, error);
//   }
// }

//v3 main with await on file write
async function main(blogName, accessToken) {
  try {
    const currentDate = getCurrentDate();
    const thing = await fetchFollowersWithToken(
      blogName,
      accessToken,
      2000,
      0
    );
    console.log(thing);
    console.log(thing.total_users);
    const userCount = thing.total_users;
    const followers = await fetchAllFollowers(blogName, 0, userCount);
    const jsonData = JSON.stringify(followers, null, 2);
    fs.writeFileSync("followers" + currentDate + ".json", jsonData);
    console.log("JSON data saved to followers.json");
    return { data: jsonData, success: true, error: null };
  } catch (error) {
    console.error(error.message, error);
    return { data: null, success: false, error: error };
  }
}

// Export the functions and variables
module.exports = {
  fetchFollowers,
  fetchAllFollowers,
  convertUnixToDate,
  reloadAndConvertJSON,
  getCurrentDate,
  main,
};
