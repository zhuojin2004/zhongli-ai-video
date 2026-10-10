import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ViewModule } from './modules/view/view.module';
import { ProductionModule } from './modules/production/production.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { VideoAnalysisModule } from './modules/video-analysis/video-analysis.module';
import { VideoEditingModule } from './modules/video-editing/video-editing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IterationModule } from './modules/iteration/iteration.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { ClipHistoryModule } from './modules/clip-history/clip-history.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    ProductionModule,
    WorkflowModule,
    VideoAnalysisModule,
    VideoEditingModule,
    DashboardModule,
    IterationModule,
    AuthorizationModule,
    MaterialsModule,
    ClipHistoryModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
