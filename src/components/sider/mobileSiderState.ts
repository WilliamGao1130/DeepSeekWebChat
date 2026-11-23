import { create } from 'zustand'

/** 移动端侧边栏轨道：顶栏菜单按钮打开，切换会话或开启新对话后关闭 */
export const useMobileSider = create(() => ({ open: false }))

export const openMobileSider = () => useMobileSider.setState({ open: true })

export const closeMobileSider = () => useMobileSider.setState({ open: false })
