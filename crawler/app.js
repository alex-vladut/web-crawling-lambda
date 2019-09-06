const AWS = require('aws-sdk');
const { get } = require('request-promise');
const { transform } = require('camaro');
const robotsParser = require('robots-parser');

AWS.config.update({ region: process.env.REGION });
const s3 = new AWS.S3();

exports.lambdaHandler = async event => {
  const sqsMessage = event.Records[0];
  const { websiteUrl, id } = JSON.parse(sqsMessage.body);
  const result = await extractWebsiteUrls(websiteUrl);

  if (result.length) {
    await s3.putObject({
      Key: `${id}.txt`,
      Bucket: process.env.S3_BUCKET,
      Body: result.join('\n')
    }).promise();
  } else {
    console.log(`No URLs found for website ${websiteUrl}`);
  }

  return result.length;
}

const extractWebsiteUrls = async websiteUrl => {
  const sitemapUrls = [...await siteMapUrls(extractDomainName(websiteUrl))];
  const allUrls = [];
  while (sitemapUrls.length) {
    try {
      const response = await get(sitemapUrls.pop(), { timeout: 1000, followRedirect: false }).promise();
      const { sitemaps, urls } = await transform(response, {
        sitemaps: ['sitemapindex/sitemap', { loc: 'loc' }],
        urls: ['/urlset/url', { loc: 'loc' }]
      });
      sitemapUrls.push(...(sitemaps || []).map(({ loc }) => loc));
      allUrls.push(...(urls || []).map(({ loc }) => loc));
    } catch (error) {
      console.error(`There was an error while processing sitemap.xml: `, error.stack || error);
    }
  }
  return allUrls;
}

const siteMapUrls = async domain => {
  let sitemaps = [];
  try {
    sitemaps = await siteMapUrlsFromRobotsTxt(domain);
  } catch (error) { /** ignore error if robots.txt can not be found for website */ }
  return sitemaps.length ? sitemaps : [`https://${domain}/sitemap.xml`, `http://${domain}/sitemap.xml`];
}

const siteMapUrlsFromRobotsTxt = async domain => {
  const url = `${domain}/robots.txt`;
  const options = {
    timeout: 500,
    followRedirect: false
  };
  let response = null;
  try {
    response = await get(`https://${url}`, options).promise();
  } catch (error) {
    response = await get(`http://${url}`, options).promise();
  }
  return robotsParser(url, response).getSitemaps();
}

const extractDomainName = fullUrl => {
  let url = fullUrl.replace(/http:\/\//g, '').replace(/https:\/\//g, '');
  url = url.indexOf('/') > 0 ? url.substring(0, url.indexOf('/')) : url;
  url = url.indexOf('\?') > 0 ? url.substring(url.indexOf('\?') - 1) : url;
  return url;
}
