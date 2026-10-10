// ---- plugin:product_image_generator_1 ----
// ============================================================
// 插件 product_image_generator_1 (产品展示图生成器) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface ProductImageGeneratorOneInput {
  /** 生成图片的比例，可选值：1:1、4:3、3:4、16:9、9:16、3:2、2:3 */
  image_ratio?: string;
  /** 产品的详细描述信息，包含产品类型、外观特点、材质、使用场景等 */
  product_description: string;
}

/**
 * capabilityClient.load('product_image_generator_1').call<ProductImageGeneratorOneOutput>('textToImage', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { images } = result;
 * 返回值形如：
 *   {"images":["示例文本"]}
 */
export interface ProductImageGeneratorOneOutput {
  /** [object Object] */
  images: string[];
}
// ---- end:product_image_generator_1 ----

// ---- plugin:generate_sales_podcast_script_1 ----
// ============================================================
// 插件 generate_sales_podcast_script_1 (销售口播脚本自动生成) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface GenerateSalesPodcastScriptOneInput {
  /** 其他自定义要求，如脚本时长、特定话术要求等（可选） */
  additional_requirements?: string;
  /** 产品详细信息，包括功能特点、优势、适用人群、价格等 */
  product_info: string;
  /** 销售员人设标签，如专业严谨、亲切活泼、幽默风趣等风格描述 */
  salesperson_persona: string;
}

/**
 * capabilityClient.load('generate_sales_podcast_script_1').callStream<GenerateSalesPodcastScriptOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 GenerateSalesPodcastScriptOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface GenerateSalesPodcastScriptOneOutput {
  /** [object Object] */
  content: string;
  /** [object Object] */
  response?: string;
}
// ---- end:generate_sales_podcast_script_1 ----

// ---- plugin:script_to_speech_female_1 ----
// ============================================================
// 插件 script_to_speech_female_1 (脚本转语音(中文女声)) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface ScriptToSpeechFemaleOneInput {
  /** 要转换为语音的脚本内容，最多3000字符 */
  script_content: string;
}

/**
 * capabilityClient.load('script_to_speech_female_1').call<ScriptToSpeechFemaleOneOutput>('speechSynthesis', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { audioUrl } = result;
 * 返回值形如：
 *   {"audioUrl":"示例文本"}
 */
export interface ScriptToSpeechFemaleOneOutput {
  /** [object Object] */
  audioUrl: string;
}
// ---- end:script_to_speech_female_1 ----

// ---- plugin:competitor_video_content_analysis_1 ----
// ============================================================
// 插件 competitor_video_content_analysis_1 (竞品视频内容分析) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface CompetitorVideoContentAnalysisOneInput {
  /** 附加搜索要求（可选） */
  additional_search_requirements?: string;
}

/**
 * capabilityClient.load('competitor_video_content_analysis_1').callStream<CompetitorVideoContentAnalysisOneOutput>('searchSummary', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 CompetitorVideoContentAnalysisOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"summary":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.summary ?? ''; }
 */
export interface CompetitorVideoContentAnalysisOneOutput {
  /** [object Object] */
  summary: string;
}
// ---- end:competitor_video_content_analysis_1 ----

// ---- plugin:video_channel_public_page_crawler_1 ----
// ============================================================
// 插件 video_channel_public_page_crawler_1 (视频号公开页面数据爬取) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface VideoChannelPublicPageCrawlerOneInput {
  /** 视频号公开页面的URL链接 */
  video_channel_page_url: string;
}

/**
 * capabilityClient.load('video_channel_public_page_crawler_1').callStream<VideoChannelPublicPageCrawlerOneOutput>('crawlWebPage', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 VideoChannelPublicPageCrawlerOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface VideoChannelPublicPageCrawlerOneOutput {
  /** [object Object] */
  content: string;
}
// ---- end:video_channel_public_page_crawler_1 ----

// ---- plugin:forklift_industry_channel_search_summary_1 ----
// ============================================================
// 插件 forklift_industry_channel_search_summary_1 (叉车行业视频号数据搜索) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface ForkliftIndustryChannelSearchSummaryOneInput {

}

/**
 * capabilityClient.load('forklift_industry_channel_search_summary_1').callStream<ForkliftIndustryChannelSearchSummaryOneOutput>('searchSummary', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 ForkliftIndustryChannelSearchSummaryOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"summary":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.summary ?? ''; }
 */
export interface ForkliftIndustryChannelSearchSummaryOneOutput {
  /** [object Object] */
  summary: string;
}
// ---- end:forklift_industry_channel_search_summary_1 ----