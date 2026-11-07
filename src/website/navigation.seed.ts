import { Prisma, PrismaClient } from "@prisma/client";

type MenuLink = { label: string; href: string; active?: boolean };
type MenuColumn = { heading: string; items: MenuLink[] };
type FeaturedCard = {
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
};
type NavigationSeed = {
  seedKey: string;
  slug: string;
  title: string;
  category: "header" | "footer" | "utility";
  style?: "simple" | "dropdown" | "mega";
  href?: string;
  sortOrder: number;
  items?: MenuLink[];
  columns?: MenuColumn[];
  eyebrow?: string;
  featuredCard?: FeaturedCard;
};

const link = (label: string, href: string): MenuLink => ({ label, href });
const column = (heading: string, ...items: MenuLink[]): MenuColumn => ({
  heading,
  items,
});

export const schoolNavigationSeed: NavigationSeed[] = [
  {
    seedKey: "school-main-our-school",
    slug: "seed-main-our-school",
    title: "Our School",
    category: "header",
    style: "mega",
    href: "/our-school",
    sortOrder: 1,
    eyebrow: "HERITAGE & GOVERNANCE",
    columns: [
      column(
        "Our Heritage",
        link("Welcome from the Head", "/our-school/head"),
        link("Ethos & Values", "/our-school/ethos-and-values"),
        link("Our History", "/our-school/history"),
      ),
      column(
        "Leadership & Governance",
        link("Leadership Team", "/our-school/leadership"),
        link("Governors & Governance", "/our-school/governance"),
      ),
      column(
        "Care & Facilities",
        link("Pastoral Care & Wellbeing", "/our-school/pastoral-care"),
        link("Safeguarding", "/our-school/safeguarding"),
        link("School Facilities", "/our-school/facilities"),
      ),
      column(
        "Information",
        link("Policies & Reports", "/our-school/policies"),
        link("Careers at the School", "/careers"),
      ),
    ],
    featuredCard: {
      eyebrow: "DISCOVER",
      title: "Discover Our School",
      description: "Explore our heritage, values and community.",
      ctaLabel: "Explore Our School",
      href: "/our-school",
    },
  },
  {
    seedKey: "school-main-learning",
    slug: "seed-main-learning",
    title: "Learning",
    category: "header",
    style: "mega",
    href: "/learning",
    sortOrder: 2,
    eyebrow: "CURRICULUM & RIGOUR",
    columns: [
      column(
        "Early Learning",
        link("Curriculum Overview", "/learning"),
        link("Early Years", "/learning/early-years"),
        link("Pre-Prep", "/learning/pre-prep"),
      ),
      column(
        "School Stages",
        link("Prep School", "/learning/prep"),
        link("Senior School", "/learning/senior-school"),
        link("Sixth Form", "/learning/sixth-form"),
      ),
      column(
        "Academic Support",
        link("Academic Subjects", "/learning/subjects"),
        link("Learning Support", "/learning/support"),
      ),
      column(
        "Outcomes & Futures",
        link("Assessment & Results", "/learning/results"),
        link("University Destinations", "/learning/destinations"),
        link("Careers & Futures", "/learning/careers"),
      ),
    ],
    featuredCard: {
      eyebrow: "LEARNING",
      title: "Explore Our Curriculum",
      description:
        "Discover how we inspire curiosity, confidence and academic achievement.",
      ctaLabel: "Explore Learning",
      href: "/learning",
    },
  },
  {
    seedKey: "school-main-school-life",
    slug: "seed-main-school-life",
    title: "School Life",
    category: "header",
    style: "mega",
    href: "/school-life",
    sortOrder: 3,
    eyebrow: "COMMUNITY & CO-CURRICULAR",
    columns: [
      column(
        "Community",
        link("Life at Our School", "/school-life"),
        link("Houses & Community", "/school-life/houses"),
        link("Boarding", "/school-life/boarding"),
      ),
      column(
        "Sport & Performance",
        link("Sport & Physical Education", "/school-life/sport"),
        link("Music", "/school-life/music"),
        link("Drama & Performing Arts", "/school-life/drama"),
      ),
      column(
        "Arts & Activities",
        link("Art & Design", "/school-life/art"),
        link("Clubs & Activities", "/school-life/clubs"),
        link("Trips & Expeditions", "/school-life/trips"),
      ),
      column(
        "Pastoral & Facilities",
        link("Pastoral Care", "/school-life/pastoral-care"),
        link("School Gallery", "/school-life/gallery"),
        link("Food & Catering", "/school-life/catering"),
      ),
    ],
    featuredCard: {
      eyebrow: "SCHOOL LIFE",
      title: "Experience School Life",
      description: "Discover the opportunities that help every pupil thrive.",
      ctaLabel: "Discover School Life",
      href: "/school-life",
    },
  },
  {
    seedKey: "school-main-admissions",
    slug: "seed-main-admissions",
    title: "Admissions",
    category: "header",
    style: "mega",
    href: "/admissions",
    sortOrder: 4,
    eyebrow: "JOIN OUR SCHOOL",
    columns: [
      column(
        "Start Here",
        link("Admissions Overview", "/admissions"),
        link("How to Apply", "/admissions/how-to-apply"),
        link("Entry Requirements", "/admissions/entry-requirements"),
      ),
      column(
        "Visits & Entry",
        link("Book an Open Day", "/admissions/open-days"),
        link("Arrange a Visit", "/admissions/book-a-visit"),
        link("Entry at Each Stage", "/admissions/entry-points"),
      ),
      column(
        "Fees & Scholarships",
        link("Fees & Bursaries", "/admissions/fees-and-bursaries"),
        link("Scholarships", "/admissions/scholarships"),
        link("International Admissions", "/admissions/international"),
      ),
      column(
        "Planning Your Application",
        link("Frequently Asked Questions", "/admissions/faqs"),
        link("Prospectus", "/admissions/prospectus"),
        link("Start Your Application", "/admissions/apply"),
      ),
    ],
    featuredCard: {
      eyebrow: "ADMISSIONS",
      title: "Come and Meet Us",
      description:
        "Discover our school, meet our team and explore our facilities.",
      ctaLabel: "Book Your Visit",
      href: "/admissions/book-a-visit",
    },
  },
  {
    seedKey: "school-main-news-events",
    slug: "seed-main-news-events",
    title: "News & Events",
    category: "header",
    style: "dropdown",
    href: "/news",
    sortOrder: 5,
    items: [
      link("Latest News", "/news"),
      link("Upcoming Events", "/events"),
      link("School Calendar", "/calendar"),
      link("Term Dates", "/term-dates"),
      link("Newsletters", "/newsletters"),
      link("Achievements", "/achievements"),
      link("Photo & Video Highlights", "/gallery"),
    ],
  },
  {
    seedKey: "school-main-contact",
    slug: "seed-main-contact",
    title: "Contact",
    category: "header",
    style: "dropdown",
    href: "/contact",
    sortOrder: 6,
    items: [
      link("Contact Details", "/contact"),
      link("Find Us", "/contact/find-us"),
      link("General Enquiries", "/contact/general-enquiries"),
      link("Admissions Enquiries", "/contact/admissions"),
      link("Staff Directory", "/contact/staff"),
      link("Report a Concern", "/contact/report-a-concern"),
    ],
  },
  {
    seedKey: "school-utility-parent-portal",
    slug: "seed-utility-parent-portal",
    title: "Parent Portal",
    category: "utility",
    style: "simple",
    href: "/parent-portal",
    sortOrder: 1,
  },
  {
    seedKey: "school-utility-term-dates",
    slug: "seed-utility-term-dates",
    title: "Term Dates",
    category: "utility",
    style: "simple",
    href: "/term-dates",
    sortOrder: 2,
  },
  {
    seedKey: "school-utility-calendar",
    slug: "seed-utility-calendar",
    title: "Calendar",
    category: "utility",
    style: "simple",
    href: "/calendar",
    sortOrder: 3,
  },
  {
    seedKey: "school-utility-staff-access",
    slug: "seed-utility-staff-access",
    title: "Staff Access",
    category: "utility",
    style: "simple",
    href: "/staff-access",
    sortOrder: 4,
  },
  {
    seedKey: "footer_our_school",
    slug: "footer-our-school",
    title: "About the School",
    category: "footer",
    sortOrder: 1,
    items: [
      link("About Us", "/our-school"),
      link("Headteacher's Welcome", "/our-school/head"),
      link("Vision & Values", "/our-school/ethos-and-values"),
      link("Leadership Team", "/our-school/leadership"),
      link("Staff Directory", "/contact/staff"),
      link("Departments", "/departments"),
      link("Contact Us", "/contact"),
      link("Vacancies", "/careers"),
    ],
  },
  {
    seedKey: "footer_learning",
    slug: "footer-learning",
    title: "Learning & School Life",
    category: "footer",
    sortOrder: 2,
    items: [
      link("Curriculum", "/learning"),
      link("Departments", "/departments"),
      link("Exam Results", "/learning/results"),
      link("School Performance", "/school-performance"),
      link("Clubs & Activities", "/school-life/clubs"),
      link("School Meals", "/school-life/catering"),
      link("School Uniform", "/school-uniform"),
      link("Transport", "/transport"),
    ],
  },
  {
    seedKey: "footer_school_life",
    slug: "footer-school-life",
    title: "Parents & Students",
    category: "footer",
    sortOrder: 3,
    items: [
      link("Parent Information", "/parent-information"),
      link("Student Information", "/student-information"),
      link("Term Dates", "/term-dates"),
      link("School Calendar", "/calendar"),
      link("Attendance", "/attendance"),
      link("Homework / Remote Learning", "/homework-remote-learning"),
      link("Admissions", "/admissions"),
      link("Book a Visit", "/admissions/book-a-visit"),
    ],
  },
  {
    seedKey: "footer_admissions",
    slug: "footer-admissions",
    title: "Safeguarding & Support",
    category: "footer",
    sortOrder: 4,
    items: [
      link("Safeguarding", "/our-school/safeguarding"),
      link("SEND Information", "/send-information"),
      link("Pastoral Care", "/our-school/pastoral-care"),
      link("Pupil Premium", "/pupil-premium"),
      link("Equality & Inclusion", "/equality-and-inclusion"),
      link("Online Safety", "/online-safety"),
      link("Accessibility", "/accessibility"),
      link("Report a Concern", "/contact/report-a-concern"),
    ],
  },
  {
    seedKey: "footer_quick_links",
    slug: "footer-policies-statutory-information",
    title: "Policies & Statutory Information",
    category: "footer",
    sortOrder: 5,
    items: [
      link("Ofsted Reports", "/ofsted-reports"),
      link("School Performance", "/school-performance"),
      link("Policies & Documents", "/our-school/policies"),
      link("Admissions Policy", "/our-school/policies/admissions"),
      link("Behaviour Policy", "/our-school/policies/behaviour"),
      link("Attendance Policy", "/our-school/policies/attendance"),
      link("Complaints Procedure", "/our-school/policies/complaints"),
      link("Child Protection Policy", "/our-school/policies/child-protection"),
      link("Privacy Policy", "/privacy"),
    ],
  },
  {
    seedKey: "footer_statutory_information",
    slug: "footer-statutory-information",
    title: "School Information & Statutory Documents",
    category: "footer",
    sortOrder: 6,
    items: [
      link(
        "School Information & Statutory Documents",
        "/school-information-statutory-documents",
      ),
    ],
  },
  {
    seedKey: "footer_legal",
    slug: "footer-information-policies",
    title: "Legal Information",
    category: "footer",
    sortOrder: 7,
    items: [
      link("Privacy Policy", "/privacy"),
      link("Cookie Policy", "/cookies"),
      link("Accessibility Statement", "/accessibility"),
      link("Website Terms of Use", "/terms"),
    ],
  },
];

function getMenuContent(menu: NavigationSeed): Prisma.InputJsonObject {
  if (menu.category === "footer") {
    return {
      category: menu.category,
      active: true,
      sortOrder: menu.sortOrder,
      items: menu.items ?? [],
    };
  }
  return {
    category: menu.category,
    ...(menu.style ? { style: menu.style } : {}),
    ...(menu.href ? { href: menu.href, external: false } : {}),
    active: true,
    sortOrder: menu.sortOrder,
    ...(menu.items ? { items: menu.items } : {}),
    ...(menu.columns ? { columns: menu.columns } : {}),
    ...(menu.eyebrow ? { eyebrow: menu.eyebrow } : {}),
    ...(menu.featuredCard ? { featuredCard: menu.featuredCard } : {}),
  };
}

export async function seedSchoolNavigation(
  prisma: PrismaClient,
  schoolId: string,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    for (const menu of schoolNavigationSeed) {
      const existing = await transaction.websitePage.findUnique({
        where: {
          schoolId_seedKey: { schoolId, seedKey: menu.seedKey },
        },
        include: {
          versions: {
            where: { versionNumber: 1 },
            select: { versionNumber: true },
          },
        },
      });

      if (!existing) {
        const publishedAt = new Date();
        const slugCollision = await transaction.websitePage.findUnique({
          where: { schoolId_slug: { schoolId, slug: menu.slug } },
          select: { id: true },
        });
        if (slugCollision) {
          throw new Error(
            `Cannot seed navigation "${menu.title}": slug "${menu.slug}" is already used by a non-seed page.`,
          );
        }

        await transaction.websitePage.create({
          data: {
            schoolId,
            seedKey: menu.seedKey,
            slug: menu.slug,
            publishedSlug: menu.slug,
            contentType: "navigation",
            title: menu.title,
            status: "published",
            currentVersionNumber: 1,
            publishedVersionNumber: 1,
            publishedAt,
            createdById: actorId,
            versions: {
              create: {
                versionNumber: 1,
                slug: menu.slug,
                title: menu.title,
                status: "published",
                content: getMenuContent(menu),
                createdById: actorId,
                approvedAt: publishedAt,
                publishedAt,
              },
            },
          },
        });
        continue;
      }

      if (
        existing.currentVersionNumber !== 1 ||
        existing.publishedVersionNumber !== 1 ||
        existing.status !== "published"
      ) {
        continue;
      }

      if (existing.versions.length !== 1) {
        throw new Error(
          `Seed-owned navigation "${menu.seedKey}" is missing its initial version.`,
        );
      }

      await transaction.websitePage.update({
        where: { id: existing.id },
        data: {
          slug: menu.slug,
          publishedSlug: menu.slug,
          title: menu.title,
          status: "published",
          versions: {
            update: {
              where: {
                schoolId_pageId_versionNumber: {
                  schoolId,
                  pageId: existing.id,
                  versionNumber: 1,
                },
              },
              data: {
                slug: menu.slug,
                title: menu.title,
                status: "published",
                content: getMenuContent(menu),
              },
            },
          },
        },
      });
    }
  });
}
