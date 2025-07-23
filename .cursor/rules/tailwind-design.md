---
alwaysApply: true
---

# Tailwind CSS Design Consistency Rules

## Design Preservation
**CRITICAL**: When modifying templates, maintain the existing design patterns. DO NOT change the visual design of the application.

### Existing Design System

#### Color Palette (DO NOT CHANGE)
```css
/* Primary Colors */
bg-blue-600, text-blue-600     /* Primary buttons, links */
bg-green-600, text-green-600   /* Success states */
bg-red-600, text-red-600       /* Error states, danger buttons */
bg-purple-600, text-purple-600 /* Accent elements */
bg-gray-50, bg-gray-100        /* Background colors */
text-gray-900, text-gray-500   /* Text colors */
```

#### Layout Patterns (REUSE THESE)
```handlebars
{{!-- Card Container --}}
<div class="bg-white shadow rounded-lg">
  <div class="px-4 py-5 sm:p-6">
    <!-- Content -->
  </div>
</div>

{{!-- Stats Grid --}}
<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
  <div class="bg-white overflow-hidden shadow rounded-lg">
    <div class="p-5">
      <!-- Stat content -->
    </div>
  </div>
</div>

{{!-- Two Column Layout --}}
<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
  <!-- Content -->
</div>

{{!-- Table Layout --}}
<div class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
  <table class="min-w-full divide-y divide-gray-300">
    <!-- Table content -->
  </table>
</div>
```

#### Button Styles (USE EXACTLY)
```handlebars
{{!-- Primary Button --}}
<a href="#" class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
  Button Text
</a>

{{!-- Secondary Button --}}
<a href="#" class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
  Button Text
</a>

{{!-- Success Button --}}
<button class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700">
  Success Action
</button>

{{!-- Danger Button --}}
<button class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700">
  Delete
</button>
```

#### Form Elements (MAINTAIN CONSISTENCY)
```handlebars
{{!-- Form Group --}}
<div class="space-y-6">
  <div>
    <label for="field" class="block text-sm font-medium text-gray-700">Label</label>
    <div class="mt-1">
      <input type="text" id="field" class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md">
    </div>
  </div>
</div>

{{!-- Select Dropdown --}}
<select class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
  <option>Option</option>
</select>

{{!-- Textarea --}}
<textarea rows="3" class="shadow-sm focus:ring-blue-500 focus:border-blue-500 mt-1 block w-full sm:text-sm border border-gray-300 rounded-md"></textarea>
```

#### Navigation (DO NOT MODIFY)
The existing navigation in `partials/navigation.hbs` uses:
- Sidebar layout with `lg:pl-72` offset
- Icon + text pattern
- Active state highlighting
- Responsive design

### CSS Compilation
When modifying Tailwind classes, recompile using Docker:
```bash
docker-compose -f docker-compose.dev.yml exec sim-api npx tailwindcss -i /usr/src/app/apps/api/src/public/input.css -o /usr/src/app/apps/api/src/public/output.css
```

### Spacing and Layout Rules
- Use consistent spacing: `p-4`, `p-5`, `p-6`, `px-4 py-5`, `sm:p-6`
- Maintain grid gaps: `gap-6`, `gap-8`
- Use responsive prefixes: `sm:`, `md:`, `lg:`
- Stick to existing shadow levels: `shadow`, `shadow-sm`

### Status Indicators (REUSE PATTERNS)
```handlebars
{{!-- Success Status --}}
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
  Active
</span>

{{!-- Error Status --}}
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
  Failed
</span>

{{!-- Processing Status --}}
<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
  Processing
</span>
```

### Forbidden Design Changes
❌ **NEVER** change the color scheme
❌ **NEVER** modify the layout structure without reusing existing patterns
❌ **NEVER** introduce new component styles
❌ **NEVER** change typography scales
❌ **NEVER** modify the navigation design
❌ **NEVER** add custom CSS classes outside of Tailwind

### When Adding New Content
✅ **ALWAYS** use existing component patterns from other templates
✅ **ALWAYS** maintain visual consistency
✅ **ALWAYS** follow the established spacing and color rules
✅ **ALWAYS** use the same button and form styles 