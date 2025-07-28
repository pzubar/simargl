// Components for AdminJS
import { ComponentLoader } from 'adminjs';

const componentLoader = new ComponentLoader();

// Register the analysis display component using absolute path for Docker
const Components = {
  AnalysisDisplay: componentLoader.add('AnalysisDisplay', '/usr/src/app/apps/api/src/admin/components/analysis-display'),
  ThumbnailDisplay: componentLoader.add('ThumbnailDisplay', '/usr/src/app/apps/api/src/admin/components/thumbnail-display'),
};

export { componentLoader, Components };
