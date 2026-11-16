// Shared bits of the oic-sync guide pages (/oic-sync/).

export const OIC_SYNC_REPO = "https://github.com/open-img-cloud/oic-sync";
export const OIC_SYNC_README = `${OIC_SYNC_REPO}#readme`;

const SITE = "https://openimages.cloud";
const publisher = { "@type": "Organization", name: "Open Image Cloud", url: `${SITE}/` };

/** BreadcrumbList for a page under /oic-sync/ (the overview itself when `page` is omitted). */
export function breadcrumb(page?: { name: string; path: string }) {
  const items = [{ name: "oic-sync", path: "/oic-sync/" }, ...(page ? [page] : [])];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE}${item.path}`,
    })),
  };
}

/** TechArticle for one guide page. */
export function techArticle(a: {
  headline: string;
  description: string;
  path: string;
  about: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: a.headline,
    description: a.description,
    url: `${SITE}${a.path}`,
    inLanguage: "en",
    about: a.about.map((name) => ({ "@type": "Thing", name })),
    isPartOf: { "@type": "WebSite", name: "Open Image Cloud", url: `${SITE}/` },
    author: publisher,
    publisher,
    mentions: {
      "@type": "SoftwareApplication",
      name: "oic-sync",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Linux",
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      url: OIC_SYNC_REPO,
    },
  };
}
