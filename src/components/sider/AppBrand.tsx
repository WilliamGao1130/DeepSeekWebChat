import logo from '../../assets/deepseek-logo.svg'
import styles from './AppBrand.module.css'

/** 侧边栏品牌标识：官方鲸鱼与 DeepSeek 字标组合，以及反色 API 标签 */
export const AppBrand = () => (
  <div className={styles.brand}>
    <span
      className={styles.wordmark}
      role="img"
      aria-label="deepseek"
      dangerouslySetInnerHTML={{ __html: logo }}
    />
    <span className={styles.apiBadge}>
      <span className={styles.apiText}>API</span>
    </span>
  </div>
)
