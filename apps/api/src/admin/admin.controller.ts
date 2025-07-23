import { Controller, Get, Post, Put, Delete, Param, Body, Res, Query, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { AdminService, CreateChannelDto, CreateContentDto, CreatePromptDto } from './admin.service';
import { TemplateService } from './template.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly templateService: TemplateService,
  ) {}

  // ============== SHARED STYLES ==============
  private getSharedStyles() {
    return `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; text-align: center; margin-bottom: 30px; box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
        .nav { background: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .nav a { color: #667eea; text-decoration: none; margin-right: 20px; padding: 8px 12px; border-radius: 6px; transition: all 0.2s; }
        .nav a:hover, .nav a.active { background: #667eea; color: white; }
        .card { background: white; padding: 25px; margin: 20px 0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; padding: 25px; border-radius: 12px; text-align: center; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.3); }
        .stat h3 { font-size: 2em; margin-bottom: 8px; }
        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb; }
        .stat-number { margin: 0 0 5px 0; font-size: 32px; color: #3b82f6; font-weight: bold; }
        .stat-label { margin: 0; color: #6b7280; font-size: 14px; }
        .dashboard-section { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin-bottom: 20px; }
        .dashboard-section h3 { margin-top: 0; color: #1f2937; }
        .dashboard-section p { color: #6b7280; margin-bottom: 0; }
        .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .table th, .table td { padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }
        .table th { background: #f8fafc; font-weight: 600; color: #374151; border-top: 1px solid #e2e8f0; }
        .table tr:hover { background: #f8fafc; }
        .btn { display: inline-block; padding: 10px 16px; border: none; border-radius: 6px; text-decoration: none; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; margin: 2px; }
        .btn-primary { background: #667eea; color: white; }
        .btn-primary:hover { background: #5a67d8; transform: translateY(-1px); }
        .btn-success { background: #48bb78; color: white; }
        .btn-success:hover { background: #38a169; }
        .btn-danger { background: #f56565; color: white; }
        .btn-danger:hover { background: #e53e3e; }
        .btn-secondary { background: #a0aec0; color: white; }
        .btn-secondary:hover { background: #718096; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 500; color: #374151; }
        .form-control { width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; transition: border-color 0.2s; }
        .form-control:focus { outline: none; border-color: #667eea; box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1); }
        .form-control.textarea { min-height: 120px; resize: vertical; }
        .alert { padding: 15px; border-radius: 6px; margin-bottom: 20px; }
        .alert-success { background: #f0fff4; border: 1px solid #9ae6b4; color: #276749; }
        .alert-error { background: #fed7d7; border: 1px solid #feb2b2; color: #742a2a; }
        .actions { display: flex; gap: 8px; }
        .breadcrumb { margin-bottom: 20px; color: #6b7280; }
        .breadcrumb a { color: #667eea; text-decoration: none; }
        .empty-state { text-align: center; padding: 60px 20px; color: #6b7280; }
        .empty-state h3 { margin-bottom: 8px; color: #374151; }
      </style>
    `;
  }

  private getNavigation(activeTab: string = '') {
    return `
      <nav class="nav">
        <a href="/admin" class="${activeTab === 'dashboard' ? 'active' : ''}">🏠 Dashboard</a>
        <a href="/admin/channels" class="${activeTab === 'channels' ? 'active' : ''}">📺 Channels</a>
        <a href="/admin/contents" class="${activeTab === 'contents' ? 'active' : ''}">📄 Contents</a>
        <a href="/admin/prompts" class="${activeTab === 'prompts' ? 'active' : ''}">💬 Prompts</a>
        <a href="/queues" target="_blank">📈 Queues</a>
        <a href="/channels" target="_blank">🔗 API</a>
      </nav>
    `;
  }

  private formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // ============== DASHBOARD ==============
  @Get()
  async dashboard(@Res() res: Response) {
    const stats = await this.adminService.getDashboardStats();
    
    // Simplified response to bypass template issues
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Simargl Admin</title>
  <link href="/public/output.css" rel="stylesheet" />
</head>
<body class="bg-gray-50">
  <div class="container mx-auto p-8">
    <h1 class="text-3xl font-bold text-gray-900 mb-8">📊 Dashboard</h1>
    
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-lg font-semibold text-gray-900">Total Channels</h3>
        <p class="text-3xl font-bold text-blue-600">${stats.channelCount}</p>
      </div>
      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-lg font-semibold text-gray-900">Total Content</h3>
        <p class="text-3xl font-bold text-green-600">${stats.contentCount}</p>
      </div>
      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-lg font-semibold text-gray-900">Total Prompts</h3>
        <p class="text-3xl font-bold text-purple-600">${stats.promptCount}</p>
      </div>
    </div>

    <div class="bg-white p-6 rounded-lg shadow">
      <h2 class="text-xl font-semibold mb-4">Quick Actions</h2>
      <div class="space-x-4">
        <a href="/admin/channels" class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          View Channels
        </a>
        <a href="/admin/contents" class="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">
          View Content
        </a>
        <a href="/admin/channels/new" class="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700">
          Add Channel
        </a>
      </div>
    </div>
  </div>
</body>
</html>`);
  }

  // ============== CHANNELS ==============
  @Get('channels')
  async channelsList(@Res() res: Response) {
    const channelsRaw = await this.adminService.getAllChannels();
    
    // Convert Mongoose documents to plain objects to avoid Handlebars property access issues
    const channels = channelsRaw.map(channel => ({
      _id: channel._id?.toString(),
      name: channel.name,
      sourceType: channel.sourceType,
      sourceId: channel.sourceId,
      cronPattern: channel.cronPattern,
      fetchLastN: channel.fetchLastN,
      authorContext: channel.authorContext,
      createdAt: (channel as any).createdAt,
      updatedAt: (channel as any).updatedAt,
      metadata: channel.metadata || {}
    }));


    console.log(JSON.stringify(channels, null, 2));
    const html = this.templateService.renderLayout('main', 'admin/channels-list.hbs', {
      title: 'Channels',
      currentPage: 'channels',
      showNavigation: true,
      pageHeader: {
        title: '📺 Channels',
        description: 'Manage content sources and scheduling',
        actions: [
          {
            text: 'Add Channel',
            url: '/admin/channels/new',
            class: 'inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500',
            icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>`
          }
        ]
      },
      breadcrumbs: [
        { title: 'Dashboard', url: '/admin' },
        { title: 'Channels', url: '/admin/channels' }
      ],
      channels
    });
    res.send(html);
  }

  @Get('channels/new')
  async channelForm(@Res() res: Response) {
    const html = this.templateService.renderLayout('main', 'admin/channel-form.hbs', {
      title: 'New Channel',
      currentPage: 'channels',
      showNavigation: true,
      pageHeader: {
        title: '📺 Create New Channel',
        description: 'Add a new content source'
      },
      breadcrumbs: [
        { title: 'Dashboard', url: '/admin' },
        { title: 'Channels', url: '/admin/channels' },
        { title: 'New', url: '/admin/channels/new' }
      ]
    });
    res.send(html);
  }

  @Post('channels')
  async createChannel(@Body() createChannelDto: CreateChannelDto, @Res() res: Response) {
    try {
      await this.adminService.createChannel(createChannelDto);
      res.redirect('/admin/channels');
    } catch (error) {
      res.status(400).send('Error creating channel: ' + error.message);
    }
  }

  @Get('channels/:id')
  async channelDetail(@Param('id') id: string, @Res() res: Response) {
    try {
      const channel = await this.adminService.getChannelById(id);
      if (!channel) {
        return res.status(404).send('Channel not found');
      }

      // Get channel content (limit to recent 10 for the detail view)
      const allContents = await this.adminService.getAllContents();
      const contents = allContents.filter(content => 
        content.channelId && content.channelId._id && content.channelId._id.toString() === id
      ).slice(0, 10);

      const html = this.templateService.renderLayout('main', 'admin/channel-detail.hbs', {
        title: channel.name,
        currentPage: 'channels',
        showNavigation: true,
        pageHeader: {
          title: `📺 ${channel.name}`,
          description: `${channel.sourceType} channel details and content`,
          actions: [
            {
              text: 'Edit Channel',
              url: `/admin/channels/${id}/edit`,
              class: 'inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500',
              icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>`
            }
          ]
        },
        breadcrumbs: [
          { title: 'Dashboard', url: '/admin' },
          { title: 'Channels', url: '/admin/channels' },
          { title: channel.name, url: `/admin/channels/${id}` }
        ],
        channel,
        contents
      });
      res.send(html);
    } catch (error) {
      console.error('Error loading channel detail:', error);
      res.status(500).send('Error loading channel');
    }
  }

  @Get('channels/:id/edit')
  async editChannelForm(@Param('id') id: string, @Res() res: Response) {
    try {
      const channel = await this.adminService.getChannelById(id);
      if (!channel) {
        return res.status(404).send('Channel not found');
      }

      res.render('admin/channel-form', {
        title: `Edit ${channel.name}`,
        currentPage: 'channels',
        showNavigation: true,
        pageHeader: {
          title: `📺 Edit Channel`,
          description: `Modify ${channel.name} settings`
        },
        breadcrumbs: [
          { title: 'Dashboard', url: '/admin' },
          { title: 'Channels', url: '/admin/channels' },
          { title: channel.name, url: `/admin/channels/${id}` },
          { title: 'Edit', url: `/admin/channels/${id}/edit` }
        ],
        channel
      });
    } catch (error) {
      console.error('Error loading channel for edit:', error);
      res.status(500).send('Error loading channel');
    }
  }

  @Put('channels/:id')
  async updateChannel(@Param('id') id: string, @Body() updateData: Partial<CreateChannelDto>, @Res() res: Response) {
    try {
      await this.adminService.updateChannel(id, updateData);
      res.json({ success: true });
    } catch (error) {
      res.status(400).send('Error updating channel: ' + error.message);
    }
  }

  @Delete('channels/:id')
  async deleteChannel(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.adminService.deleteChannel(id);
      res.redirect('/admin/channels');
    } catch (error) {
      console.error('Error deleting channel:', error);
      res.status(500).send('Error deleting channel');
    }
  }

  // ============== RECURRING JOB MANAGEMENT ==============
  @Post('jobs/start-all-polling')
  async startAllChannelPolling(@Res() res: Response) {
    try {
      const result = await this.adminService.startAllChannelPolling();
      res.json({
        success: true,
        message: `Started recurring polling for ${result.scheduledChannels} YouTube channels`,
        ...result
      });
    } catch (error) {
      console.error('Error starting all channel polling:', error);
      res.status(500).json({
        success: false,
        message: 'Error starting channel polling',
        error: error.message
      });
    }
  }

  @Post('jobs/stop-all-polling')
  async stopAllChannelPolling(@Res() res: Response) {
    try {
      const result = await this.adminService.stopAllChannelPolling();
      res.json({
        success: true,
        message: `Stopped recurring polling for ${result.stoppedChannels} YouTube channels`,
        ...result
      });
    } catch (error) {
      console.error('Error stopping all channel polling:', error);
      res.status(500).json({
        success: false,
        message: 'Error stopping channel polling',
        error: error.message
      });
    }
  }

  @Post('channels/:id/update-cron')
  async updateChannelCronPattern(
    @Param('id') id: string,
    @Body() body: { cronPattern: string },
    @Res() res: Response
  ) {
    try {
      await this.adminService.updateChannelCronPattern(id, body.cronPattern);
      res.json({
        success: true,
        message: `Updated cron pattern for channel ${id} to: ${body.cronPattern}`
      });
    } catch (error) {
      console.error('Error updating channel cron pattern:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating cron pattern',
        error: error.message
      });
    }
  }

  @Post('channels/:id/poll-now')
  async pollChannelNow(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.adminService.triggerManualChannelPoll(id);
      res.json({
        success: true,
        message: `Manually triggered immediate poll for channel ${id}`
      });
    } catch (error) {
      console.error('Error triggering manual poll:', error);
      res.status(500).json({
        success: false,
        message: 'Error triggering manual poll',
        error: error.message
      });
    }
  }

  // ============== CONTENTS ==============
  @Get('contents')
  async contentsList(@Res() res: Response) {
    const contentsRaw = await this.adminService.getAllContents();
    
    // Convert Mongoose documents to plain objects to avoid Handlebars property access issues
    const contents = contentsRaw.map(content => ({
      _id: content._id?.toString(),
      title: content.title,
      sourceContentId: content.sourceContentId,
      channelId: content.channelId ? {
        name: (content.channelId as any).name || 'Unknown',
        sourceType: (content.channelId as any).sourceType || 'UNKNOWN'
      } : null,
      status: content.status,
      publishedAt: content.publishedAt,
      createdAt: (content as any).createdAt,
      updatedAt: (content as any).updatedAt,
      metadata: content.metadata ? {
        thumbnails: { 
          default: content.metadata.thumbnailUrl,
          medium: content.metadata.thumbnailUrl 
        },
        viewCount: content.metadata.viewCount,
        duration: content.metadata.duration
      } : null,
      analysis: content.analysis ? {
        modelUsed: content.analysis.modelUsed,
        result: content.analysis.result
      } : null
    })); 
    
    // Calculate stats
    const stats = {
      total: contents.length,
      analyzed: contents.filter(c => c.status === 'ANALYZED').length,
      processing: contents.filter(c => c.status === 'PROCESSING').length,
      failed: contents.filter(c => c.status === 'FAILED').length,
    };

    const html = this.templateService.renderLayout('main', 'admin/content-list.hbs', {
      title: 'Contents',
      currentPage: 'contents',
      showNavigation: true,
      pageHeader: {
        title: '📄 Content Management',
        description: 'Manage your content items and analysis results',
        actions: [
          {
            text: 'Add Content',
            url: '/admin/contents/new',
            class: 'inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500',
            icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>'
          }
        ]
      },
      breadcrumbs: [
        { title: 'Dashboard', url: '/admin' },
        { title: 'Contents', url: '/admin/contents' }
      ],
      contents,
      stats
    });
    res.send(html);
  }

  // ============== CONTENT CRUD METHODS ==============
  @Get('contents/new')
  async contentForm(@Res() res: Response) {
    const channels = await this.adminService.getAllChannels();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>New Content - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📄 Create New Content</h1>
            <p>Add a new content item</p>
          </div>
          
          ${this.getNavigation('contents')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/contents">Contents</a> / New
          </div>
          
          <div class="card">
            <form id="contentForm">
              <div class="form-group">
                <label for="title">Title *</label>
                <input type="text" id="title" name="title" class="form-control" required placeholder="Content title">
              </div>
              
              <div class="form-group">
                <label for="channelId">Channel</label>
                <select id="channelId" name="channelId" class="form-control">
                  <option value="">Select a channel...</option>
                  ${channels.map(channel => `
                    <option value="${channel._id}">${channel.name} (${channel.sourceType})</option>
                  `).join('')}
                </select>
              </div>
              
              <div class="form-group">
                <label for="sourceContentId">Source Content ID *</label>
                <input type="text" id="sourceContentId" name="sourceContentId" class="form-control" required placeholder="External content ID">
              </div>
              
              <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description" class="form-control textarea" placeholder="Content description..."></textarea>
              </div>
              
              <div class="form-group">
                <label for="url">URL</label>
                <input type="url" id="url" name="url" class="form-control" placeholder="https://...">
              </div>
              
              <div class="form-group">
                <label for="publishedAt">Published Date</label>
                <input type="datetime-local" id="publishedAt" name="publishedAt" class="form-control">
              </div>
              
              <div style="display: flex; gap: 10px; margin-top: 30px;">
                <button type="submit" class="btn btn-success">Create Content</button>
                <a href="/admin/contents" class="btn btn-secondary">Cancel</a>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          document.getElementById('contentForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            if (data.publishedAt) {
              data.publishedAt = new Date(data.publishedAt).toISOString();
            }
            
            try {
              const response = await fetch('/admin/contents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              
              if (response.ok) {
                alert('Content created successfully!');
                window.location.href = '/admin/contents';
              } else {
                const error = await response.text();
                alert('Error creating content: ' + error);
              }
            } catch (error) {
              alert('Error: ' + error.message);
            }
          });
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  }

  @Post('contents')
  async createContent(@Body() createContentDto: CreateContentDto, @Res() res: Response) {
    try {
      await this.adminService.createContent(createContentDto);
      res.redirect('/admin/contents');
    } catch (error) {
      res.status(400).send('Error creating content: ' + error.message);
    }
  }

  @Get('contents/:id')
  async contentDetail(@Param('id') id: string, @Res() res: Response) {
    const contentRaw = await this.adminService.getContentById(id);
    if (!contentRaw) {
      return res.status(404).send('Content not found');
    }

    // Convert Mongoose document to plain object
    const content = {
      _id: contentRaw._id?.toString(),
      title: contentRaw.title,
      sourceContentId: contentRaw.sourceContentId,
      description: contentRaw.description,
      channelId: contentRaw.channelId ? {
        name: (contentRaw.channelId as any).name || 'Unknown',
        channelId: (contentRaw.channelId as any).channelId || ''
      } : null,
      status: contentRaw.status,
      publishedAt: contentRaw.publishedAt,
      createdAt: (contentRaw as any).createdAt,
      updatedAt: (contentRaw as any).updatedAt,
      metadata: contentRaw.metadata ? {
        thumbnails: { 
          default: contentRaw.metadata.thumbnailUrl,
          high: contentRaw.metadata.thumbnailUrl 
        },
        viewCount: contentRaw.metadata.viewCount,
        duration: contentRaw.metadata.duration
      } : null,
      analysis: contentRaw.analysis ? {
        modelUsed: contentRaw.analysis.modelUsed,
        promptVersion: contentRaw.analysis.promptVersion,
        promptName: contentRaw.analysis.promptName,
        promptId: contentRaw.analysis.promptId,
        result: contentRaw.analysis.result
      } : null
    };

    const data = {
      title: content.title,
      currentPage: 'contents',
      pageHeader: {
        title: content.title,
        description: 'Content details and analysis results',
        actions: [
          {
            url: `/admin/contents/${content._id}/edit`,
            text: 'Edit',
            class: 'btn btn-secondary',
            icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>'
          }
        ]
      },
      breadcrumbs: [
        { title: 'Dashboard', url: '/admin' },
        { title: 'Contents', url: '/admin/contents' },
        { title: content.title, url: `/admin/contents/${content._id}` }
      ],
      content,
      contentCount: 0, // Will be populated by template service
    };

    const html = this.templateService.renderLayout('main', 'admin/content-detail.hbs', data);
    res.send(html);
  }

  @Get('contents/:id/edit')
  async editContentForm(@Param('id') id: string, @Res() res: Response) {
    const content = await this.adminService.getContentById(id);
    const channels = await this.adminService.getAllChannels();
    if (!content) {
      return res.status(404).send('Content not found');
    }

    const formatDateForInput = (date: Date | string) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toISOString().slice(0, 16); // Format for datetime-local input
    };

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Edit ${content.title} - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📄 Edit Content</h1>
            <p>Update content information</p>
          </div>
          
          ${this.getNavigation('contents')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/contents">Contents</a> / <a href="/admin/contents/${content._id}">${content.title}</a> / Edit
          </div>
          
          <div class="card">
            <form id="contentForm">
              <div class="form-group">
                <label for="title">Title *</label>
                <input type="text" id="title" name="title" class="form-control" required value="${content.title}">
              </div>
              
              <div class="form-group">
                <label for="channelId">Channel</label>
                <select id="channelId" name="channelId" class="form-control">
                  <option value="">Select a channel...</option>
                  ${channels.map(channel => `
                    <option value="${channel._id}" ${(content.channelId as any)?._id === channel._id.toString() ? 'selected' : ''}>${channel.name} (${channel.sourceType})</option>
                  `).join('')}
                </select>
              </div>
              
              <div class="form-group">
                <label for="sourceId">Source ID *</label>
                <input type="text" id="sourceId" name="sourceId" class="form-control" required value="${content.sourceContentId}">
              </div>
              
              <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description" class="form-control textarea">${content.description || ''}</textarea>
              </div>
              
              <div class="form-group">
                <label for="url">URL</label>
                    <input type="url" id="url" name="url" class="form-control" value="${content.sourceContentId || ''}">
              </div>
              
              <div class="form-group">
                <label for="publishedAt">Published Date</label>
                <input type="datetime-local" id="publishedAt" name="publishedAt" class="form-control" value="${formatDateForInput(content.publishedAt)}">
              </div>
              
              <div style="display: flex; gap: 10px; margin-top: 30px;">
                <button type="submit" class="btn btn-success">Update Content</button>
                <a href="/admin/contents/${content._id}" class="btn btn-secondary">Cancel</a>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          document.getElementById('contentForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            if (data.publishedAt) {
              data.publishedAt = new Date(data.publishedAt).toISOString();
            }
            
            try {
              const response = await fetch('/admin/contents/${content._id}', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              
              if (response.ok) {
                alert('Content updated successfully!');
                window.location.href = '/admin/contents/${content._id}';
              } else {
                const error = await response.text();
                alert('Error updating content: ' + error);
              }
            } catch (error) {
              alert('Error: ' + error.message);
            }
          });
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  }

  @Put('contents/:id')
  async updateContent(@Param('id') id: string, @Body() updateData: Partial<CreateContentDto>, @Res() res: Response) {
    try {
      await this.adminService.updateContent(id, updateData);
      res.json({ success: true });
    } catch (error) {
      res.status(400).send('Error updating content: ' + error.message);
    }
  }

  @Delete('contents/:id')
  async deleteContent(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.adminService.deleteContent(id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).send('Error deleting content: ' + error.message);
    }
  }

  // ============== PROMPTS (Similar structure for Prompts) ==============
  @Get('prompts')
  async promptsList(@Res() res: Response) {
    const prompts = await this.adminService.getAllPrompts();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Prompts - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💬 Prompt Management</h1>
            <p>Manage your AI prompts</p>
          </div>
          
          ${this.getNavigation('prompts')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / Prompts
          </div>
          
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h2>All Prompts (${prompts.length})</h2>
              <a href="/admin/prompts/new" class="btn btn-success">+ Add New Prompt</a>
            </div>
            
            ${prompts.length > 0 ? `
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${prompts.map(prompt => `
                    <tr>
                      <td><strong>${prompt.promptName}</strong></td>
                      <td>${prompt.description || 'No description'}</td>
                      <td>
                        <span style="background: ${prompt.isDefault ? '#48bb78' : '#a0aec0'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                          ${prompt.isDefault ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td class="actions">
                        <a href="/admin/prompts/${prompt._id}" class="btn btn-primary">View</a>
                        <a href="/admin/prompts/${prompt._id}/edit" class="btn btn-secondary">Edit</a>
                        <button onclick="deletePrompt('${prompt._id}', '${prompt.promptName}')" class="btn btn-danger">Delete</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `
              <div class="empty-state">
                <h3>No prompts found</h3>
                <p>Create your first AI prompt</p>
                <a href="/admin/prompts/new" class="btn btn-primary">Create First Prompt</a>
              </div>
            `}
          </div>
        </div>
        
        <script>
          async function deletePrompt(id, name) {
            if (confirm('Are you sure you want to delete "' + name + '"? This action cannot be undone.')) {
              try {
                const response = await fetch('/admin/prompts/' + id, { method: 'DELETE' });
                if (response.ok) {
                  alert('Prompt deleted successfully');
                  location.reload();
                } else {
                  alert('Failed to delete prompt');
                }
              } catch (error) {
                alert('Error: ' + error.message);
              }
            }
          }
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  }

  // ============== PROMPT CRUD METHODS ==============
  @Get('prompts/new')
  async promptForm(@Res() res: Response) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>New Prompt - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💬 Create New Prompt</h1>
            <p>Add a new AI prompt template</p>
          </div>
          
          ${this.getNavigation('prompts')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/prompts">Prompts</a> / New
          </div>
          
          <div class="card">
            <form id="promptForm">
              <div class="form-group">
                <label for="name">Prompt Name *</label>
                <input type="text" id="name" name="name" class="form-control" required placeholder="e.g., Content Summarizer">
              </div>
              
              <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description" class="form-control" placeholder="Brief description of what this prompt does..."></textarea>
              </div>
              
              <div class="form-group">
                <label for="promptTemplate">Prompt Template *</label>
                <textarea id="promptTemplate" name="promptTemplate" class="form-control textarea" required placeholder="Enter your prompt template here...

Example:
Summarize the following content in 3 bullet points:

{content}

Provide a brief summary that captures the main ideas." style="min-height: 200px;"></textarea>
                <small style="color: #6b7280; font-size: 12px;">Use {variable_name} for dynamic content substitution</small>
              </div>
              
              <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px;">
                  <input type="checkbox" id="isActive" name="isActive" checked>
                  <span>Active Prompt</span>
                </label>
              </div>
              
              <div style="display: flex; gap: 10px; margin-top: 30px;">
                <button type="submit" class="btn btn-success">Create Prompt</button>
                <a href="/admin/prompts" class="btn btn-secondary">Cancel</a>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          document.getElementById('promptForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            // Handle checkbox
            data.isActive = document.getElementById('isActive').checked;
            
            try {
              const response = await fetch('/admin/prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              
              if (response.ok) {
                alert('Prompt created successfully!');
                window.location.href = '/admin/prompts';
              } else {
                const error = await response.text();
                alert('Error creating prompt: ' + error);
              }
            } catch (error) {
              alert('Error: ' + error.message);
            }
          });
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  }

  @Post('prompts')
  async createPrompt(@Body() createPromptDto: CreatePromptDto, @Res() res: Response) {
    try {
      await this.adminService.createPrompt(createPromptDto);
      res.redirect('/admin/prompts');
    } catch (error) {
      res.status(400).send('Error creating prompt: ' + error.message);
    }
  }

  @Get('prompts/:id')
  async promptDetail(@Param('id') id: string, @Res() res: Response) {
    const prompt = await this.adminService.getPromptById(id);
    if (!prompt) {
      return res.status(404).send('Prompt not found');
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${prompt.promptName} - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💬 ${prompt.promptName}</h1>
            <p>Prompt Details</p>
          </div>
          
          ${this.getNavigation('prompts')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/prompts">Prompts</a> / ${prompt.promptName}
          </div>
          
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h2>Prompt Information</h2>
              <div class="actions">
                <a href="/admin/prompts/${prompt._id}/edit" class="btn btn-primary">Edit Prompt</a>
                <button onclick="deletePrompt('${prompt._id}', '${prompt.promptName}')" class="btn btn-danger">Delete Prompt</button>
              </div>
            </div>
            
            <table class="table">
              <tr><th>Name</th><td>${prompt.promptName}</td></tr>
              <tr><th>Description</th><td>${prompt.description || 'Not provided'}</td></tr>
              <tr><th>Status</th><td>
                <span style="background: ${prompt.isDefault ? '#48bb78' : '#a0aec0'}; color: white; padding: 4px 8px; border-radius: 4px;">
                  ${prompt.isDefault ? 'Active' : 'Inactive'}
                </span>
              </td></tr>
              <tr><th>Template</th><td><pre style="background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0; white-space: pre-wrap; font-family: 'Monaco', 'Consolas', monospace;">${prompt.promptTemplate}</pre></td></tr>
            </table>
          </div>
        </div>
        
        <script>
          async function deletePrompt(id, name) {
            if (confirm('Are you sure you want to delete "' + name + '"? This action cannot be undone.')) {
              try {
                const response = await fetch('/admin/prompts/' + id, { method: 'DELETE' });
                if (response.ok) {
                  alert('Prompt deleted successfully');
                  window.location.href = '/admin/prompts';
                } else {
                  alert('Failed to delete prompt');
                }
              } catch (error) {
                alert('Error: ' + error.message);
              }
            }
          }
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  }

  @Get('prompts/:id/edit')
  async editPromptForm(@Param('id') id: string, @Res() res: Response) {
    const prompt = await this.adminService.getPromptById(id);
    if (!prompt) {
      return res.status(404).send('Prompt not found');
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Edit ${prompt.promptName} - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💬 Edit Prompt</h1>
            <p>Update prompt settings</p>
          </div>
          
          ${this.getNavigation('prompts')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/prompts">Prompts</a> / <a href="/admin/prompts/${prompt._id}">${prompt.promptName}</a> / Edit
          </div>
          
          <div class="card">
            <form id="promptForm">
              <div class="form-group">
                <label for="name">Prompt Name *</label>
                <input type="text" id="name" name="name" class="form-control" required value="${prompt.promptName}">
              </div>
              
              <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description" class="form-control">${prompt.description || ''}</textarea>
              </div>
              
              <div class="form-group">
                <label for="promptTemplate">Prompt Template *</label>
                <textarea id="promptTemplate" name="promptTemplate" class="form-control textarea" required style="min-height: 200px;">${prompt.promptTemplate}</textarea>
              </div>
              
              <div class="form-group">
                <label style="display: flex; align-items: center; gap: 8px;">
                  <input type="checkbox" id="isActive" name="isActive" ${prompt.isDefault ? 'checked' : ''}>
                  <span>Active Prompt</span>
                </label>
              </div>
              
              <div style="display: flex; gap: 10px; margin-top: 30px;">
                <button type="submit" class="btn btn-success">Update Prompt</button>
                <a href="/admin/prompts/${prompt._id}" class="btn btn-secondary">Cancel</a>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          document.getElementById('promptForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            // Handle checkbox
            data.isActive = document.getElementById('isActive').checked;
            
            try {
              const response = await fetch('/admin/prompts/${prompt._id}', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              
              if (response.ok) {
                alert('Prompt updated successfully!');
                window.location.href = '/admin/prompts/${prompt._id}';
              } else {
                const error = await response.text();
                alert('Error updating prompt: ' + error);
              }
            } catch (error) {
              alert('Error: ' + error.message);
            }
          });
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  }

  @Put('prompts/:id')
  async updatePrompt(@Param('id') id: string, @Body() updateData: Partial<CreatePromptDto>, @Res() res: Response) {
    try {
      await this.adminService.updatePrompt(id, updateData);
      res.json({ success: true });
    } catch (error) {
      res.status(400).send('Error updating prompt: ' + error.message);
    }
  }

  @Delete('prompts/:id')
  async deletePrompt(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.adminService.deletePrompt(id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).send('Error deleting prompt: ' + error.message);
    }
  }
} 