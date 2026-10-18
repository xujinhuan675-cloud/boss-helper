import type { HelperContext } from './composables/useHelper'
import { traceDiagnostic } from './utils/diagnostics'

export async function reloadSettings(
  ctx: Pick<HelperContext<any, any, any>, 'conf' | 'resumes' | 'models'>,
) {
  await traceDiagnostic('settings.reload.config', () => ctx.conf.confInit())
  await traceDiagnostic('settings.reload.resumes', () =>
    ctx.resumes.init(ctx.conf.formData.resumeText),
  )
  await traceDiagnostic('settings.reload.models', () => ctx.models.initModel())
}

export async function run<C extends HelperContext<C, T, S>, T, S>(ctx: HelperContext<C, T, S>) {
  await reloadSettings(ctx)
  await ctx.statistics.updateStatistics()
  await ctx.onMount()
}
