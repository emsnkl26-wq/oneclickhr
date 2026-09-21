/**
 * The positions the document generator knows how to write about.
 *
 * Picking one fills the letter's role-specific wording — the one-line summary
 * the opening paragraph and the SERVICES clause use, and the duties list — so
 * the person generating an offer only has to choose a title. Every string is a
 * DEFAULT: it lands in the same editable fields as the rest of the template.
 *
 * A title typed under "Other" is matched to the closest preset by keyword
 * ("Senior Data Engineer" writes like a Data Engineer), and falls back to
 * honest generic wording when nothing matches.
 *
 * No directive at the top: shared by the client form and nothing else, but
 * plain data either way.
 */

export interface RolePreset {
  title: string
  group: string
  /** Completes "you will be responsible for …" — lowercase, no full stop. */
  summary: string
  responsibilities: string[]
  /** Suggested employment type when the role is picked. */
  employmentType?: string
}

const ENGINEERING = 'Software engineering'
const DATA = 'Data & AI'
const CLOUD = 'Cloud & infrastructure'
const QUALITY = 'Quality & security'
const ENTERPRISE = 'Enterprise applications'
const DELIVERY = 'Product & delivery'
const BUSINESS = 'Business & operations'
const INTERN = 'Internships'

export const ROLE_PRESETS: RolePreset[] = [
  // --- Software engineering ------------------------------------------------
  {
    title: 'Software Engineer',
    group: ENGINEERING,
    summary:
      'designing, developing, testing and maintaining software applications that meet business and client requirements',
    responsibilities: [
      'Design, develop and maintain scalable software applications and services.',
      'Translate business and functional requirements into technical designs and working code.',
      'Write clean, well-tested and maintainable code following established coding standards.',
      'Participate in code reviews, unit and integration testing, and release activities.',
      'Troubleshoot, debug and resolve production issues and performance bottlenecks.',
      'Document designs, APIs and workflows for long-term maintainability.',
      'Collaborate with product, QA and operations teams across the software development life cycle.',
    ],
  },
  {
    title: 'Senior Software Engineer',
    group: ENGINEERING,
    summary:
      'leading the design and delivery of complex software systems and guiding other engineers on technical direction and quality',
    responsibilities: [
      'Lead the architecture, design and implementation of complex software components and services.',
      'Set coding standards and review designs and code for quality, security and performance.',
      'Mentor and guide junior engineers and support their technical growth.',
      'Break down large initiatives into deliverable milestones and estimate effort.',
      'Diagnose and resolve critical production incidents and drive root-cause fixes.',
      'Evaluate new tools, frameworks and practices and recommend improvements.',
      'Work closely with stakeholders to align technical solutions with business goals.',
    ],
  },
  {
    title: 'Full Stack Developer',
    group: ENGINEERING,
    summary:
      'building and maintaining end-to-end web applications, from responsive user interfaces to back-end services, APIs and databases',
    responsibilities: [
      'Develop responsive front-end interfaces using modern JavaScript/TypeScript frameworks.',
      'Build and maintain RESTful and/or GraphQL APIs and back-end services.',
      'Design and optimize relational and NoSQL database schemas and queries.',
      'Integrate third-party services, authentication and payment or messaging providers.',
      'Write automated unit, integration and end-to-end tests.',
      'Deploy, monitor and support applications in cloud environments.',
      'Collaborate with designers and product owners to deliver features end to end.',
    ],
  },
  {
    title: 'Frontend Developer',
    group: ENGINEERING,
    summary:
      'building fast, accessible and responsive user interfaces and turning designs into production-quality front-end code',
    responsibilities: [
      'Implement pixel-accurate, responsive user interfaces from design specifications.',
      'Build reusable UI components using React, Angular or similar frameworks.',
      'Integrate front-end applications with back-end APIs and manage application state.',
      'Ensure accessibility, cross-browser compatibility and front-end performance.',
      'Write unit and component tests for user interface code.',
      'Work with UX designers to refine interactions and usability.',
    ],
  },
  {
    title: 'Backend Developer',
    group: ENGINEERING,
    summary:
      'designing and building the server-side services, APIs and data layers that power the company’s applications',
    responsibilities: [
      'Design, build and maintain server-side applications, microservices and APIs.',
      'Model data and write efficient queries for relational and NoSQL databases.',
      'Implement authentication, authorization and secure data handling.',
      'Optimize services for performance, scalability and reliability.',
      'Write automated tests and participate in code reviews.',
      'Monitor services in production and resolve incidents.',
    ],
  },
  {
    title: 'Java Developer',
    group: ENGINEERING,
    summary:
      'developing and maintaining enterprise applications and microservices using Java, Spring Boot and related technologies',
    responsibilities: [
      'Design and develop enterprise applications and microservices using Java and Spring Boot.',
      'Build and consume RESTful web services and messaging integrations.',
      'Work with relational databases using JPA/Hibernate and SQL.',
      'Write unit and integration tests with JUnit and related frameworks.',
      'Participate in code reviews, CI/CD pipelines and release activities.',
      'Troubleshoot and tune application performance in production.',
    ],
  },
  {
    title: '.NET Developer',
    group: ENGINEERING,
    summary:
      'developing and maintaining applications and services on the Microsoft .NET platform using C# and related technologies',
    responsibilities: [
      'Design, develop and maintain applications using C#, .NET and ASP.NET Core.',
      'Build and integrate Web APIs and services.',
      'Work with SQL Server and Entity Framework for data access.',
      'Write unit tests and participate in code reviews.',
      'Deploy and support applications on Azure or on-premises infrastructure.',
      'Troubleshoot defects and improve application performance.',
    ],
  },
  {
    title: 'Python Developer',
    group: ENGINEERING,
    summary:
      'building and maintaining applications, services and automation using Python and its ecosystem',
    responsibilities: [
      'Develop applications, APIs and automation scripts in Python.',
      'Build back-end services using frameworks such as Django, Flask or FastAPI.',
      'Integrate with databases, message queues and third-party APIs.',
      'Write automated tests and maintain code quality.',
      'Optimize code for performance and reliability.',
      'Document code and collaborate with cross-functional teams.',
    ],
  },
  {
    title: 'Mobile App Developer',
    group: ENGINEERING,
    summary:
      'designing and building native and cross-platform mobile applications for iOS and Android',
    responsibilities: [
      'Develop mobile applications for iOS and Android using native or cross-platform frameworks.',
      'Integrate mobile apps with back-end APIs, push notifications and analytics.',
      'Ensure performance, offline behaviour and a high-quality user experience.',
      'Write unit and UI tests for mobile code.',
      'Prepare and manage releases to the App Store and Google Play.',
      'Diagnose and fix crashes and defects reported from production.',
    ],
  },

  // --- Data & AI -----------------------------------------------------------
  {
    title: 'Data Engineer',
    group: DATA,
    summary:
      'designing, building and maintaining scalable data pipelines, data models and data platforms that deliver reliable data for analytics and business use',
    responsibilities: [
      'Design, build and maintain batch and streaming data pipelines (ETL/ELT).',
      'Develop and optimize data models in data warehouses and data lakes.',
      'Work with tools such as SQL, Python, Spark, Airflow and cloud data services.',
      'Ensure data quality, lineage, security and governance across data platforms.',
      'Tune queries and pipelines for performance and cost.',
      'Collaborate with analysts, data scientists and business teams to deliver trusted datasets.',
      'Document data flows, schemas and business logic.',
    ],
  },
  {
    title: 'Data Analyst',
    group: DATA,
    summary:
      'collecting, analysing and interpreting data and turning it into reports, dashboards and insights that support business decisions',
    responsibilities: [
      'Gather, clean and analyse data from multiple sources.',
      'Build and maintain reports and dashboards using BI tools such as Power BI or Tableau.',
      'Write SQL queries to extract and transform data.',
      'Identify trends, patterns and anomalies and present findings to stakeholders.',
      'Define and track key business metrics and KPIs.',
      'Support ad-hoc analysis requests from business teams.',
    ],
  },
  {
    title: 'Data Scientist',
    group: DATA,
    summary:
      'applying statistics, machine learning and data analysis to solve business problems and build predictive models',
    responsibilities: [
      'Explore and analyse large datasets to identify patterns and opportunities.',
      'Build, validate and deploy statistical and machine learning models.',
      'Engineer features and prepare data for modelling.',
      'Design experiments and measure the impact of models and changes.',
      'Communicate findings and recommendations to technical and business audiences.',
      'Collaborate with data engineers to productionize models and pipelines.',
    ],
  },
  {
    title: 'AI/ML Engineer',
    group: DATA,
    summary:
      'designing, developing and deploying machine learning and artificial intelligence solutions, including models, data pipelines and production ML systems',
    responsibilities: [
      'Design, train, evaluate and deploy machine learning and deep learning models.',
      'Build and integrate AI solutions, including large language model (LLM) applications.',
      'Develop data and feature pipelines for model training and inference.',
      'Implement MLOps practices for model versioning, monitoring and retraining.',
      'Optimize models for accuracy, latency and cost in production.',
      'Work with frameworks such as Python, TensorFlow, PyTorch and cloud ML services.',
      'Collaborate with data, product and engineering teams to deliver AI features.',
    ],
  },
  {
    title: 'Business Intelligence Developer',
    group: DATA,
    summary:
      'designing and delivering business intelligence solutions, data models and dashboards that give the business a trusted view of its performance',
    responsibilities: [
      'Design and build semantic data models, cubes and reporting datasets.',
      'Develop interactive dashboards and reports in Power BI, Tableau or similar tools.',
      'Write and optimize SQL and ETL processes feeding BI solutions.',
      'Work with stakeholders to define metrics and reporting requirements.',
      'Ensure report accuracy, performance and data security.',
      'Document BI solutions and train business users.',
    ],
  },
  {
    title: 'Database Administrator',
    group: DATA,
    summary:
      'installing, configuring, securing and maintaining the company’s databases to keep them available, performant and recoverable',
    responsibilities: [
      'Install, configure, upgrade and patch database systems.',
      'Monitor database performance and tune queries, indexes and configurations.',
      'Plan and test backup, recovery and disaster-recovery procedures.',
      'Manage database security, users, roles and access controls.',
      'Support developers with schema design and data migrations.',
      'Maintain documentation and runbooks for database operations.',
    ],
  },

  // --- Cloud & infrastructure ------------------------------------------------
  {
    title: 'DevOps Engineer',
    group: CLOUD,
    summary:
      'building and maintaining CI/CD pipelines, infrastructure automation and deployment processes that let software ship reliably',
    responsibilities: [
      'Design, build and maintain CI/CD pipelines for automated build, test and deployment.',
      'Automate infrastructure provisioning using Infrastructure as Code (Terraform, CloudFormation or similar).',
      'Manage containerized workloads using Docker and Kubernetes.',
      'Implement monitoring, logging and alerting for applications and infrastructure.',
      'Improve system reliability, security and deployment frequency.',
      'Collaborate with development teams to streamline release processes.',
    ],
  },
  {
    title: 'Cloud Engineer',
    group: CLOUD,
    summary:
      'designing, deploying and operating secure, scalable cloud infrastructure and services on platforms such as AWS, Azure or Google Cloud',
    responsibilities: [
      'Design and deploy cloud infrastructure on AWS, Azure or Google Cloud.',
      'Automate provisioning and configuration with Infrastructure as Code.',
      'Implement cloud networking, identity and access management and security controls.',
      'Monitor cloud resources and optimize performance and cost.',
      'Support migrations of applications and data to the cloud.',
      'Maintain documentation, runbooks and operational procedures.',
    ],
  },
  {
    title: 'Site Reliability Engineer',
    group: CLOUD,
    summary:
      'keeping production systems reliable, scalable and observable through automation, monitoring and incident response',
    responsibilities: [
      'Define and track service level objectives (SLOs) and error budgets.',
      'Build monitoring, observability and alerting for production systems.',
      'Lead incident response, post-incident reviews and remediation.',
      'Automate operational tasks and reduce manual toil.',
      'Plan capacity and improve scalability and performance.',
      'Work with engineering teams to design reliable systems.',
    ],
  },
  {
    title: 'Network Engineer',
    group: CLOUD,
    summary:
      'designing, implementing and supporting the company’s network infrastructure to keep it secure, fast and available',
    responsibilities: [
      'Design, configure and maintain LAN, WAN, VPN and wireless networks.',
      'Manage routers, switches, firewalls and load balancers.',
      'Monitor network performance and troubleshoot connectivity issues.',
      'Implement network security policies and controls.',
      'Plan network capacity and upgrades.',
      'Document network topology and configurations.',
    ],
  },
  {
    title: 'Systems Administrator',
    group: CLOUD,
    summary:
      'installing, configuring and supporting the company’s servers, systems and end-user IT infrastructure',
    responsibilities: [
      'Install, configure and maintain Windows and Linux servers.',
      'Manage user accounts, access, email and collaboration systems.',
      'Apply patches and updates and maintain system security.',
      'Monitor systems and perform backups and restores.',
      'Provide technical support and resolve system issues.',
      'Maintain documentation of systems and procedures.',
    ],
  },

  // --- Quality & security ------------------------------------------------------
  {
    title: 'QA Automation Engineer',
    group: QUALITY,
    summary:
      'ensuring software quality through test planning, automated and manual testing, and continuous improvement of testing practices',
    responsibilities: [
      'Create test plans, test cases and test scenarios from requirements.',
      'Develop and maintain automated test suites using Selenium, Cypress, Playwright or similar tools.',
      'Perform functional, regression, integration and API testing.',
      'Integrate automated tests into CI/CD pipelines.',
      'Log, track and verify defects through to resolution.',
      'Report on test coverage and quality metrics.',
    ],
  },
  {
    title: 'Cybersecurity Analyst',
    group: QUALITY,
    summary:
      'protecting the company’s systems and data by monitoring threats, responding to incidents and strengthening security controls',
    responsibilities: [
      'Monitor security events and alerts using SIEM and related tools.',
      'Investigate and respond to security incidents.',
      'Perform vulnerability assessments and coordinate remediation.',
      'Implement and review security policies, standards and controls.',
      'Support compliance and audit activities.',
      'Promote security awareness across the organization.',
    ],
  },

  // --- Enterprise applications -------------------------------------------------
  {
    title: 'Salesforce Developer',
    group: ENTERPRISE,
    summary:
      'designing, customizing and developing solutions on the Salesforce platform to support sales, service and business processes',
    responsibilities: [
      'Develop custom solutions using Apex, Lightning Web Components and Visualforce.',
      'Configure Salesforce objects, workflows, flows and security settings.',
      'Build integrations between Salesforce and external systems.',
      'Write test classes and manage deployments between environments.',
      'Gather requirements from business users and translate them into solutions.',
      'Maintain documentation and support end users.',
    ],
  },
  {
    title: 'SAP Consultant',
    group: ENTERPRISE,
    summary:
      'implementing, configuring and supporting SAP modules to meet the business process requirements of the company and its clients',
    responsibilities: [
      'Analyse business requirements and map them to SAP solutions.',
      'Configure and customize SAP modules in line with business processes.',
      'Support implementations, upgrades, testing and go-live activities.',
      'Resolve functional issues and support end users.',
      'Prepare functional specifications and documentation.',
      'Train users and support change management.',
    ],
  },
  {
    title: 'ServiceNow Developer',
    group: ENTERPRISE,
    summary:
      'building and customizing applications and workflows on the ServiceNow platform',
    responsibilities: [
      'Develop and customize ServiceNow modules, workflows and applications.',
      'Write server-side and client-side scripts and business rules.',
      'Build integrations between ServiceNow and other systems.',
      'Configure forms, catalogs, notifications and reports.',
      'Support upgrades, testing and deployments.',
      'Document configurations and support platform users.',
    ],
  },

  // --- Product & delivery ------------------------------------------------------
  {
    title: 'Business Analyst',
    group: DELIVERY,
    summary:
      'analysing business processes, gathering and documenting requirements, and bridging business stakeholders and technology teams',
    responsibilities: [
      'Elicit, analyse and document business and functional requirements.',
      'Write user stories, acceptance criteria and process flows.',
      'Analyse current processes and recommend improvements.',
      'Act as a liaison between business stakeholders and technical teams.',
      'Support user acceptance testing and solution validation.',
      'Prepare reports and presentations for stakeholders.',
    ],
  },
  {
    title: 'Project Manager',
    group: DELIVERY,
    summary:
      'planning, executing and delivering projects on time, within scope and within budget while managing stakeholders, risks and resources',
    responsibilities: [
      'Define project scope, objectives, schedule and deliverables.',
      'Plan and allocate resources and manage project budgets.',
      'Track progress and report status to stakeholders.',
      'Identify, manage and mitigate project risks and issues.',
      'Coordinate cross-functional teams and third parties.',
      'Ensure projects are delivered to agreed quality standards.',
    ],
  },
  {
    title: 'Scrum Master',
    group: DELIVERY,
    summary:
      'facilitating Agile/Scrum practices and helping delivery teams plan, remove impediments and continuously improve',
    responsibilities: [
      'Facilitate Scrum ceremonies including planning, stand-ups, reviews and retrospectives.',
      'Remove impediments and shield the team from distractions.',
      'Coach the team and organization on Agile principles and practices.',
      'Track and report on sprint progress and delivery metrics.',
      'Work with the Product Owner on backlog refinement.',
      'Foster collaboration and continuous improvement.',
    ],
  },
  {
    title: 'Product Manager',
    group: DELIVERY,
    summary:
      'defining product vision, strategy and roadmap and working with engineering and design to deliver products customers value',
    responsibilities: [
      'Define product vision, strategy and roadmap.',
      'Gather and prioritize customer and business requirements.',
      'Write product requirements and user stories and manage the backlog.',
      'Work with engineering and design to deliver features.',
      'Analyse market trends, competition and product metrics.',
      'Communicate plans and progress to stakeholders.',
    ],
  },
  {
    title: 'UI/UX Designer',
    group: DELIVERY,
    summary:
      'researching user needs and designing intuitive, visually consistent user experiences and interfaces',
    responsibilities: [
      'Conduct user research and usability testing.',
      'Create user flows, wireframes, prototypes and high-fidelity designs.',
      'Maintain and evolve design systems and style guides.',
      'Collaborate with product managers and developers through implementation.',
      'Ensure designs meet accessibility standards.',
      'Iterate on designs based on feedback and data.',
    ],
  },

  // --- Business & operations -----------------------------------------------------
  {
    title: 'Technical Recruiter',
    group: BUSINESS,
    summary:
      'sourcing, screening and hiring technical talent and managing the recruitment process from requisition to offer',
    responsibilities: [
      'Source candidates through job boards, networking and referrals.',
      'Screen resumes and conduct initial candidate interviews.',
      'Coordinate interviews with hiring managers and clients.',
      'Manage candidate pipelines in the applicant tracking system.',
      'Negotiate and extend offers and support onboarding.',
      'Build and maintain relationships with candidates and clients.',
    ],
  },
  {
    title: 'HR Generalist',
    group: BUSINESS,
    summary:
      'supporting human resources operations including onboarding, employee relations, compliance, benefits and HR records',
    responsibilities: [
      'Manage onboarding and offboarding processes.',
      'Maintain employee records and HR information systems.',
      'Support benefits administration and payroll coordination.',
      'Address employee relations questions and concerns.',
      'Ensure compliance with employment laws and company policies.',
      'Support performance management and HR projects.',
    ],
  },
  {
    title: 'Accountant',
    group: BUSINESS,
    summary:
      'maintaining accurate financial records, preparing financial statements and supporting accounting, tax and compliance activities',
    responsibilities: [
      'Record financial transactions and maintain the general ledger.',
      'Perform account reconciliations and month-end close.',
      'Prepare financial statements and management reports.',
      'Process accounts payable, receivable and invoicing.',
      'Support audits, tax filings and regulatory compliance.',
      'Improve accounting processes and internal controls.',
    ],
  },
  {
    title: 'Sales Executive',
    group: BUSINESS,
    summary:
      'identifying new business opportunities, building client relationships and growing revenue for the company’s services',
    responsibilities: [
      'Identify and develop new business opportunities and leads.',
      'Build and maintain relationships with clients and partners.',
      'Prepare proposals, quotations and presentations.',
      'Negotiate terms and close agreements.',
      'Maintain accurate records of sales activity in the CRM.',
      'Meet or exceed assigned sales targets.',
    ],
  },

  // --- Internships -----------------------------------------------------------------
  {
    title: 'Software Engineer Intern',
    group: INTERN,
    employmentType: 'Internship',
    summary:
      'learning and contributing to the design, development and testing of software applications under the guidance of experienced engineers',
    responsibilities: [
      'Assist in designing, coding and testing software features.',
      'Learn and apply the team’s development tools, coding standards and processes.',
      'Fix defects and write unit tests under supervision.',
      'Participate in code reviews, stand-ups and team meetings.',
      'Document the work completed and present learnings to the team.',
    ],
  },
  {
    title: 'Data Analyst Intern',
    group: INTERN,
    employmentType: 'Internship',
    summary:
      'learning and contributing to data collection, analysis and reporting under the guidance of experienced analysts',
    responsibilities: [
      'Assist in collecting, cleaning and organizing data.',
      'Write SQL queries and build basic reports and dashboards.',
      'Support analysis requests from the team.',
      'Learn and apply data tools and best practices.',
      'Present findings and learnings to the team.',
    ],
  },
  {
    title: 'AI/ML Intern',
    group: INTERN,
    employmentType: 'Internship',
    summary:
      'learning and contributing to the development of machine learning models and AI solutions under the guidance of experienced engineers',
    responsibilities: [
      'Assist in preparing datasets and engineering features for models.',
      'Train, evaluate and document machine learning experiments.',
      'Support the integration of models into applications.',
      'Learn and apply ML frameworks and MLOps practices.',
      'Present results and learnings to the team.',
    ],
  },
]

/** The dropdown's groups, in the order the presets list them. */
export const ROLE_GROUPS = Array.from(new Set(ROLE_PRESETS.map((role) => role.group)))

/**
 * Keyword rules for a custom title, most specific first. "Senior Java Developer"
 * must hit Java before the generic "developer" rule, so order is the logic.
 */
const KEYWORD_RULES: Array<[RegExp, string]> = [
  [/\bintern/i, 'Software Engineer Intern'],
  [/\b(ai|ml|machine learning|artificial intelligence|llm|gen ?ai|nlp|computer vision)\b/i, 'AI/ML Engineer'],
  [/data scien/i, 'Data Scientist'],
  [/data engineer|etl|big data|spark|databricks|snowflake/i, 'Data Engineer'],
  [/\b(bi|power bi|tableau|business intelligence)\b/i, 'Business Intelligence Developer'],
  [/data analy|analytics/i, 'Data Analyst'],
  [/\bdba\b|database/i, 'Database Administrator'],
  [/devops|ci\/?cd|platform engineer/i, 'DevOps Engineer'],
  [/\bsre\b|reliability/i, 'Site Reliability Engineer'],
  [/cloud|aws|azure|gcp/i, 'Cloud Engineer'],
  [/network/i, 'Network Engineer'],
  [/system(s)? admin|sysadmin|it support|help ?desk/i, 'Systems Administrator'],
  [/\bqa\b|quality|test|sdet/i, 'QA Automation Engineer'],
  [/secur|cyber|soc\b/i, 'Cybersecurity Analyst'],
  [/salesforce|sfdc/i, 'Salesforce Developer'],
  [/\bsap\b/i, 'SAP Consultant'],
  [/servicenow/i, 'ServiceNow Developer'],
  [/business analyst|\bba\b/i, 'Business Analyst'],
  [/scrum|agile coach/i, 'Scrum Master'],
  [/product (manager|owner)/i, 'Product Manager'],
  [/project manager|program manager|delivery manager|\bpm\b/i, 'Project Manager'],
  [/\bux\b|\bui\b|design/i, 'UI/UX Designer'],
  [/recruit|talent/i, 'Technical Recruiter'],
  [/\bhr\b|human resource|people/i, 'HR Generalist'],
  [/account|finance|bookkeep/i, 'Accountant'],
  [/sales|business development/i, 'Sales Executive'],
  [/java\b|spring/i, 'Java Developer'],
  [/\.net|c#|dotnet/i, '.NET Developer'],
  [/python|django|flask/i, 'Python Developer'],
  [/mobile|ios|android|flutter|react native/i, 'Mobile App Developer'],
  [/front ?end|react|angular|vue/i, 'Frontend Developer'],
  [/back ?end|node/i, 'Backend Developer'],
  [/full ?stack/i, 'Full Stack Developer'],
  [/senior|lead|principal|staff|architect/i, 'Senior Software Engineer'],
  [/engineer|developer|programmer/i, 'Software Engineer'],
]

/** The preset with exactly this title, ignoring case and spacing. */
export function exactRolePreset(title: string): RolePreset | null {
  const key = title.trim().toLowerCase()
  if (!key) return null
  return ROLE_PRESETS.find((role) => role.title.toLowerCase() === key) ?? null
}

/** The preset to write a title's wording from: exact, then by keyword, else null. */
export function rolePresetFor(title: string): RolePreset | null {
  const exact = exactRolePreset(title)
  if (exact) return exact
  const trimmed = title.trim()
  if (!trimmed) return null
  for (const [pattern, target] of KEYWORD_RULES) {
    if (pattern.test(trimmed)) return exactRolePreset(target)
  }
  return null
}
