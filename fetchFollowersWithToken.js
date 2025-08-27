// Function to fetch followers with pagination and access token
const axios = require("axios");
// Function to fetch followers with pagination and access token
async function fetchFollowersWithToken(
  blogName,
  accessToken,
  limit,
  offset = 0
) {
  try {
    const apiUrl = `https://api.tumblr.com/v2/blog/${blogName}/followers`;
    const queryParams = {
      limit,
      offset,
    };
    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    // Create an instance of Axios
    const instance = axios.create({
      baseURL: apiUrl,
      headers: headers,
      params: queryParams,
    });

    console.log("instance created is: ", instance);

    // Add interceptor to handle 401 errors
    instance.interceptors.response.use(
      (response) => {
        // If the request was successful, return the response data
        return response.data.response;
      },
      async (error) => {
        // If the request resulted in a 401 error (Unauthorized), attempt to refresh the access token
        if (error.response && error.response.status === 401) {
          console.log(
            "Received 401 error. Attempting to refresh access token..."
          );
          // Implement token refreshing logic here
          // For example:
          // const refreshedToken = await refreshToken();
          // Then update the headers with the new token and retry the request
          // headers.Authorization = `Bearer ${refreshedToken}`;
          // return instance.request(error.config);
        } else if (error.response.status === 429) {
          console.log("Received 429 error. Too many requests.");
          console.log("Response headers:", error.response.headers); // Log the headers
          //tumblr dudes said this is incorrect, calls on follower are limited to 60 per minute
          //const retryAfter = error.response.headers["retry-after"] || 60; // Default to 60 seconds if not specified
          const retryAfter =  60; // Default to 60 seconds if not specified
          console.log(`Retrying after ${retryAfter} seconds...`);
          await new Promise((resolve) =>
            setTimeout(resolve, retryAfter * 1000)
          );
          return instance.request(error.config);
        }
        throw error;
      }
    );

    // Send the request using the Axios instance
    const response = await instance.get("");
    return response;
  } catch (error) {
    console.log('Response headers:', error.response.headers); // Log the headers
                        
    throw new Error(
      `Failed to fetch followers from Tumblr API: ${error.message}, ${error}`
    );
  }
}

module.exports = {
  fetchFollowersWithToken,
  // Other functions...
};
