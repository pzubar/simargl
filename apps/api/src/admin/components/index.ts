// Components for AdminJS
import { ComponentLoader } from 'adminjs';

const componentLoader = new ComponentLoader();

// Register the analysis display component using absolute path to source
const Components = {
  AnalysisDisplay: componentLoader.add('AnalysisDisplay', '/usr/src/app/apps/api/src/admin/components/analysis-display'),
};

export { componentLoader, Components };
