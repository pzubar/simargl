---
alwaysApply: true
---

# View Templates Rules

## Handlebars Template System

### Mandatory Template Usage
**CRITICAL**: When creating or modifying views, ALWAYS use Handlebars (.hbs) templates. NEVER put raw HTML inside controllers.

### Template Structure
```
apps/api/src/views/
├── layouts/
│   └── main.hbs          # Main layout with Tailwind CSS
├── admin/
│   ├── dashboard.hbs     # Admin dashboard
│   ├── channels-list.hbs # Channel listing
│   ├── channel-form.hbs  # Channel form
│   ├── channel-detail.hbs# Channel details
│   ├── content-list.hbs  # Content listing
│   └── content-detail.hbs# Content details
└── partials/
    └── navigation.hbs    # Shared navigation
```

### Correct Template Usage Pattern

#### ✅ Correct: Use Template Service
```typescript
@Get('example')
async examplePage(@Res() res: Response) {
  const data = await this.service.getData();
  
  const html = this.templateService.renderLayout('main', 'admin/example.hbs', {
    title: 'Example Page',
    currentPage: 'example',
    showNavigation: true,
    pageHeader: {
      title: '📊 Example',
      description: 'Page description',
      actions: [{
        text: 'Add New',
        url: '/admin/example/new',
        class: 'btn btn-primary'
      }]
    },
    breadcrumbs: [
      { title: 'Dashboard', url: '/admin' },
      { title: 'Example', url: '/admin/example' }
    ],
    data
  });
  res.send(html);
}
```

#### ❌ Wrong: Inline HTML in Controller
```typescript
// NEVER DO THIS
@Get('bad-example')
async badExample(@Res() res: Response) {
  res.send(`
    <html>
      <body>
        <h1>Title</h1>
        <p>Content</p>
      </body>
    </html>
  `);
}
```

### Template Data Structure
Always pass data in this standardized format:
```typescript
{
  title: string,                    // Page title
  currentPage: string,              // For navigation highlighting
  showNavigation: boolean,          // Show sidebar nav
  pageHeader?: {
    title: string,
    description?: string,
    actions?: Array<{
      text: string,
      url: string,
      class: string,
      icon?: string
    }>
  },
  breadcrumbs?: Array<{
    title: string,
    url: string
  }>,
  alerts?: Array<{
    type: 'success' | 'error' | 'warning' | 'info',
    message: string
  }>,
  // ... page-specific data
}
```

### Creating New Templates

#### 1. Create the .hbs file in appropriate directory
```handlebars
{{!-- apps/api/src/views/admin/new-page.hbs --}}
<div class="bg-white shadow rounded-lg">
  <div class="px-4 py-5 sm:p-6">
    <h3 class="text-lg leading-6 font-medium text-gray-900">{{title}}</h3>
    {{#if data}}
      <!-- Template content using existing Tailwind patterns -->
    {{/if}}
  </div>
</div>
```

#### 2. Use in controller
```typescript
@Get('new-page')
async newPage(@Res() res: Response) {
  const html = this.templateService.renderLayout('main', 'admin/new-page.hbs', {
    title: 'New Page',
    currentPage: 'new-page',
    showNavigation: true,
    data: await this.service.getData()
  });
  res.send(html);
}
```

### Forbidden Practices
❌ **NEVER** put HTML in controller methods
❌ **NEVER** use `res.render()` directly without template service
❌ **NEVER** inline large amounts of HTML strings
❌ **NEVER** bypass the layout system

### Template Service Integration
Always inject and use the TemplateService:
```typescript
constructor(
  private readonly adminService: AdminService,
  private readonly templateService: TemplateService,
) {}
```

### Form Handling
For forms, create separate template files and handle via template service, not inline HTML. 