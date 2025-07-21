import { Controller, Get, Post, Put, Delete, Param, Body, Res, Query, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { AdminService, CreateChannelDto, CreateContentDto, CreatePromptDto } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
    const recentChannels = await this.adminService.getAllChannels();
    const recentContents = await this.adminService.getAllContents();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Simargl Admin Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔥 Simargl Platform</h1>
            <p>Administrative Dashboard</p>
          </div>
          
          ${this.getNavigation('dashboard')}
          
          <div class="stats">
            <div class="stat">
              <h3>${stats.channelCount}</h3>
              <p>Total Channels</p>
            </div>
            <div class="stat">
              <h3>${stats.contentCount}</h3>
              <p>Total Contents</p>
            </div>
            <div class="stat">
              <h3>${stats.promptCount}</h3>
              <p>Total Prompts</p>
            </div>
          </div>
          
          <div class="card">
            <h2>📺 Recent Channels</h2>
            ${recentChannels.length > 0 ? `
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Source ID</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentChannels.slice(0, 5).map(channel => `
                    <tr>
                      <td>${channel.name}</td>
                      <td><span class="badge">${channel.sourceType}</span></td>
                      <td>${channel.sourceId}</td>
                      <td class="actions">
                        <a href="/admin/channels/${channel._id}" class="btn btn-primary">View</a>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <p><a href="/admin/channels" class="btn btn-secondary">View All Channels</a></p>
            ` : `
              <div class="empty-state">
                <h3>No channels yet</h3>
                <p>Create your first channel to get started</p>
                <a href="/admin/channels/new" class="btn btn-primary">Create Channel</a>
              </div>
            `}
          </div>
        </div>
      </body>
      </html>
    `;
    
    res.send(html);
  }

  // ============== CHANNELS ==============
  @Get('channels')
  async channelsList(@Res() res: Response) {
    const channels = await this.adminService.getAllChannels();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Channels - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📺 Channel Management</h1>
            <p>Manage your content channels</p>
          </div>
          
          ${this.getNavigation('channels')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / Channels
          </div>
          
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h2>All Channels (${channels.length})</h2>
              <a href="/admin/channels/new" class="btn btn-success">+ Add New Channel</a>
            </div>
            
            ${channels.length > 0 ? `
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Source ID</th>
                    <th>Fetch Last N</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${channels.map(channel => `
                    <tr>
                      <td><strong>${channel.name}</strong></td>
                      <td><span style="background: #667eea; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${channel.sourceType}</span></td>
                      <td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 3px;">${channel.sourceId}</code></td>
                      <td>${channel.fetchLastN || 'N/A'}</td>
                      <td class="actions">
                        <a href="/admin/channels/${channel._id}" class="btn btn-primary">View</a>
                        <a href="/admin/channels/${channel._id}/edit" class="btn btn-secondary">Edit</a>
                        <button onclick="deleteChannel('${channel._id}', '${channel.name}')" class="btn btn-danger">Delete</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `
              <div class="empty-state">
                <h3>No channels found</h3>
                <p>Create your first channel to start monitoring content</p>
                <a href="/admin/channels/new" class="btn btn-primary">Create First Channel</a>
              </div>
            `}
          </div>
        </div>
        
        <script>
          async function deleteChannel(id, name) {
            if (confirm('Are you sure you want to delete "' + name + '"? This action cannot be undone.')) {
              try {
                const response = await fetch('/admin/channels/' + id, { method: 'DELETE' });
                if (response.ok) {
                  alert('Channel deleted successfully');
                  location.reload();
                } else {
                  alert('Failed to delete channel');
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

  @Get('channels/new')
  async channelForm(@Res() res: Response) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>New Channel - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📺 Create New Channel</h1>
            <p>Add a new content source</p>
          </div>
          
          ${this.getNavigation('channels')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/channels">Channels</a> / New
          </div>
          
          <div class="card">
            <form id="channelForm">
              <div class="form-group">
                <label for="name">Channel Name *</label>
                <input type="text" id="name" name="name" class="form-control" required placeholder="e.g., My YouTube Channel">
              </div>
              
              <div class="form-group">
                <label for="sourceType">Source Type *</label>
                <select id="sourceType" name="sourceType" class="form-control" required>
                  <option value="">Select source type...</option>
                  <option value="YOUTUBE">YouTube</option>
                  <option value="TELEGRAM">Telegram</option>
                  <option value="TIKTOK">TikTok</option>
                </select>
              </div>
              
              <div class="form-group">
                <label for="sourceId">Source ID *</label>
                <input type="text" id="sourceId" name="sourceId" class="form-control" required placeholder="e.g., UCXuqSBlHAE6Xw-yeJA0Tunw">
                <small style="color: #6b7280; font-size: 12px;">For YouTube: Channel ID (starts with UC), for Telegram: @username</small>
              </div>
              
              <div class="form-group">
                <label for="fetchLastN">Fetch Last N Items</label>
                <input type="number" id="fetchLastN" name="fetchLastN" class="form-control" min="1" max="100" value="5" placeholder="5">
              </div>
              
              <div class="form-group">
                <label for="cronPattern">Cron Pattern</label>
                <input type="text" id="cronPattern" name="cronPattern" class="form-control" value="0 */6 * * *" placeholder="0 */6 * * *">
                <small style="color: #6b7280; font-size: 12px;">Default: Every 6 hours</small>
              </div>
              
              <div class="form-group">
                <label for="authorContext">Author Context</label>
                <textarea id="authorContext" name="authorContext" class="form-control textarea" placeholder="Brief description of the channel author/content style..."></textarea>
              </div>
              
              <div style="display: flex; gap: 10px; margin-top: 30px;">
                <button type="submit" class="btn btn-success">Create Channel</button>
                <a href="/admin/channels" class="btn btn-secondary">Cancel</a>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          document.getElementById('channelForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            // Convert number fields
            if (data.fetchLastN) data.fetchLastN = parseInt(data.fetchLastN);
            
            try {
              const response = await fetch('/admin/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              
              if (response.ok) {
                alert('Channel created successfully!');
                window.location.href = '/admin/channels';
              } else {
                const error = await response.text();
                alert('Error creating channel: ' + error);
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
    const channel = await this.adminService.getChannelById(id);
    if (!channel) {
      return res.status(404).send('Channel not found');
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${channel.name} - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📺 ${channel.name}</h1>
            <p>Channel Details</p>
          </div>
          
          ${this.getNavigation('channels')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/channels">Channels</a> / ${channel.name}
          </div>
          
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h2>Channel Information</h2>
              <div class="actions">
                <a href="/admin/channels/${channel._id}/edit" class="btn btn-primary">Edit Channel</a>
                <button onclick="deleteChannel('${channel._id}', '${channel.name}')" class="btn btn-danger">Delete Channel</button>
              </div>
            </div>
            
            <table class="table">
              <tr><th>Name</th><td>${channel.name}</td></tr>
              <tr><th>Source Type</th><td><span style="background: #667eea; color: white; padding: 4px 8px; border-radius: 4px;">${channel.sourceType}</span></td></tr>
              <tr><th>Source ID</th><td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 3px;">${channel.sourceId}</code></td></tr>
              <tr><th>Fetch Last N</th><td>${channel.fetchLastN || 'Not set'}</td></tr>
              <tr><th>Cron Pattern</th><td>${channel.cronPattern || 'Not set'}</td></tr>
              <tr><th>Author Context</th><td>${channel.authorContext || 'Not provided'}</td></tr>
            </table>
          </div>
        </div>
        
        <script>
          async function deleteChannel(id, name) {
            if (confirm('Are you sure you want to delete "' + name + '"? This action cannot be undone.')) {
              try {
                const response = await fetch('/admin/channels/' + id, { method: 'DELETE' });
                if (response.ok) {
                  alert('Channel deleted successfully');
                  window.location.href = '/admin/channels';
                } else {
                  alert('Failed to delete channel');
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

  @Get('channels/:id/edit')
  async editChannelForm(@Param('id') id: string, @Res() res: Response) {
    const channel = await this.adminService.getChannelById(id);
    if (!channel) {
      return res.status(404).send('Channel not found');
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Edit ${channel.name} - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📺 Edit Channel</h1>
            <p>Update channel settings</p>
          </div>
          
          ${this.getNavigation('channels')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/channels">Channels</a> / <a href="/admin/channels/${channel._id}">${channel.name}</a> / Edit
          </div>
          
          <div class="card">
            <form id="channelForm">
              <div class="form-group">
                <label for="name">Channel Name *</label>
                <input type="text" id="name" name="name" class="form-control" required value="${channel.name}">
              </div>
              
              <div class="form-group">
                <label for="sourceType">Source Type *</label>
                <select id="sourceType" name="sourceType" class="form-control" required>
                  <option value="YOUTUBE" ${channel.sourceType === 'YOUTUBE' ? 'selected' : ''}>YouTube</option>
                  <option value="TELEGRAM" ${channel.sourceType === 'TELEGRAM' ? 'selected' : ''}>Telegram</option>
                  <option value="TIKTOK" ${channel.sourceType === 'TIKTOK' ? 'selected' : ''}>TikTok</option>
                </select>
              </div>
              
              <div class="form-group">
                <label for="sourceId">Source ID *</label>
                <input type="text" id="sourceId" name="sourceId" class="form-control" required value="${channel.sourceId}">
              </div>
              
              <div class="form-group">
                <label for="fetchLastN">Fetch Last N Items</label>
                <input type="number" id="fetchLastN" name="fetchLastN" class="form-control" min="1" max="100" value="${channel.fetchLastN || ''}">
              </div>
              
              <div class="form-group">
                <label for="cronPattern">Cron Pattern</label>
                <input type="text" id="cronPattern" name="cronPattern" class="form-control" value="${channel.cronPattern || ''}">
              </div>
              
              <div class="form-group">
                <label for="authorContext">Author Context</label>
                <textarea id="authorContext" name="authorContext" class="form-control textarea">${channel.authorContext || ''}</textarea>
              </div>
              
              <div style="display: flex; gap: 10px; margin-top: 30px;">
                <button type="submit" class="btn btn-success">Update Channel</button>
                <a href="/admin/channels/${channel._id}" class="btn btn-secondary">Cancel</a>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          document.getElementById('channelForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            // Convert number fields
            if (data.fetchLastN) data.fetchLastN = parseInt(data.fetchLastN);
            
            try {
              const response = await fetch('/admin/channels/${channel._id}', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
              });
              
              if (response.ok) {
                alert('Channel updated successfully!');
                window.location.href = '/admin/channels/${channel._id}';
              } else {
                const error = await response.text();
                alert('Error updating channel: ' + error);
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
      res.json({ success: true });
    } catch (error) {
      res.status(400).send('Error deleting channel: ' + error.message);
    }
  }

  // ============== CONTENTS (Similar structure for Contents) ==============
  @Get('contents')
  async contentsList(@Res() res: Response) {
    const contents = await this.adminService.getAllContents();
    const channels = await this.adminService.getAllChannels(); // For the dropdown

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Contents - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📄 Content Management</h1>
            <p>Manage your content items</p>
          </div>
          
          ${this.getNavigation('contents')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / Contents
          </div>
          
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h2>All Contents (${contents.length})</h2>
              <a href="/admin/contents/new" class="btn btn-success">+ Add New Content</a>
            </div>
            
            ${contents.length > 0 ? `
              <table class="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Channel</th>
                    <th>Source ID</th>
                    <th>Published</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${contents.map(content => `
                    <tr>
                      <td><strong>${content.title}</strong></td>
                      <td>${content.channelId ? (content.channelId as any).name || 'Unknown' : 'No Channel'}</td>
                      <td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 3px;">${content.sourceContentId}</code></td>
                      <td>${content.publishedAt ? this.formatDate(content.publishedAt) : 'Not set'}</td>
                      <td class="actions">
                        <a href="/admin/contents/${content._id}" class="btn btn-primary">View</a>
                        <a href="/admin/contents/${content._id}/edit" class="btn btn-secondary">Edit</a>
                        <button onclick="deleteContent('${content._id}', '${content.title}')" class="btn btn-danger">Delete</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `
              <div class="empty-state">
                <h3>No contents found</h3>
                <p>Create your first content item</p>
                <a href="/admin/contents/new" class="btn btn-primary">Create First Content</a>
              </div>
            `}
          </div>
        </div>
        
        <script>
          async function deleteContent(id, title) {
            if (confirm('Are you sure you want to delete "' + title + '"? This action cannot be undone.')) {
              try {
                const response = await fetch('/admin/contents/' + id, { method: 'DELETE' });
                if (response.ok) {
                  alert('Content deleted successfully');
                  location.reload();
                } else {
                  alert('Failed to delete content');
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
    const content = await this.adminService.getContentById(id);
    if (!content) {
      return res.status(404).send('Content not found');
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${content.title} - Simargl Admin</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${this.getSharedStyles()}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📄 ${content.title}</h1>
            <p>Content Details</p>
          </div>
          
          ${this.getNavigation('contents')}
          
          <div class="breadcrumb">
            <a href="/admin">Dashboard</a> / <a href="/admin/contents">Contents</a> / ${content.title}
          </div>
          
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h2>Content Information</h2>
              <div class="actions">
                <a href="/admin/contents/${content._id}/edit" class="btn btn-primary">Edit Content</a>
                <button onclick="deleteContent('${content._id}', '${content.title}')" class="btn btn-danger">Delete Content</button>
              </div>
            </div>
            
            <table class="table">
              <tr><th>Title</th><td>${content.title}</td></tr>
              <tr><th>Channel</th><td>${content.channelId ? (content.channelId as any).name || 'Unknown' : 'No Channel'}</td></tr>
              <tr><th>Source ID</th><td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 3px;">${content.sourceContentId}</code></td></tr>
              <tr><th>Description</th><td>${content.description || 'Not provided'}</td></tr>
              <tr><th>Published</th><td>${content.publishedAt ? this.formatDate(content.publishedAt) : 'Not set'}</td></tr>
            </table>
          </div>
        </div>
        
        <script>
          async function deleteContent(id, title) {
            if (confirm('Are you sure you want to delete "' + title + '"? This action cannot be undone.')) {
              try {
                const response = await fetch('/admin/contents/' + id, { method: 'DELETE' });
                if (response.ok) {
                  alert('Content deleted successfully');
                  window.location.href = '/admin/contents';
                } else {
                  alert('Failed to delete content');
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