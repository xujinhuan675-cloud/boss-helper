import type { HelperContext } from './composables/useHelper'

export async function reloadSettings(
  ctx: Pick<HelperContext<any, any, any>, 'conf' | 'resumes' | 'models'>,
) {
  await ctx.conf.confInit()
  await ctx.resumes.init(ctx.conf.formData.resumeText)
  await ctx.models.initModel()
}

export async function run<C extends HelperContext<C, T, S>, T, S>(ctx: HelperContext<C, T, S>) {
  await reloadSettings(ctx)
  await ctx.statistics.updateStatistics()
  await ctx.onMount()
}
