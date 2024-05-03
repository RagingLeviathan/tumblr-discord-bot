function transformTumblrUrl(url) {
    const regex = /https:\/\/www\.tumblr\.com\/([a-zA-Z0-9-]+)\/(\d+)\/(.+)/;
    const match = url.match(regex);

    if (match && match.length === 4) {
        const username = match[1];
        const postId = match[2];
        const postSlug = match[3];
        return `https://${username}.tumblr.com/${postId}/${postSlug}`;
    } else {
        return "Invalid Tumblr URL format";
    }
}

// Fetch URL from command-line arguments
const originalUrl = process.argv[2];

if (originalUrl) {
    const transformedUrl = transformTumblrUrl(originalUrl);
    console.log(transformedUrl);
} else {
    console.log("Please provide a Tumblr URL as a command-line argument.");
}
