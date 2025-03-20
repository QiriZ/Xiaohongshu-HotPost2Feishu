/**
 * 小红书爆款文章筛选与飞书保存 - 侧边栏交互逻辑
 * 主要功能：
 * 1. 管理用户界面交互
 * 2. 处理文章筛选和飞书保存的业务逻辑
 * 3. 显示操作结果和日志信息
 */

// 全局变量
let filteredArticles = []; // 存储筛选后的文章
let isLoading = false; // 加载状态标志

// DOM 元素引用
const thresholdInput = document.getElementById('threshold');
const analyzeBtn = document.getElementById('analyze-btn');
const saveBtn = document.getElementById('save-btn');
const articleList = document.getElementById('article-list');
const resultCount = document.getElementById('result-count');
const logsContainer = document.getElementById('logs-list');
const toggleLogsBtn = document.getElementById('toggle-logs-btn');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// 飞书配置表单元素
const appIdInput = document.getElementById('app-id');
const appSecretInput = document.getElementById('app-secret');
const baseIdInput = document.getElementById('base-id');
const tableIdInput = document.getElementById('table-id');
const saveConfigBtn = document.getElementById('save-config-btn');

// 选项卡切换
const tabs = document.querySelectorAll('.tab-item');
const tabContents = document.querySelectorAll('.tab-content');

/**
 * 初始化页面
 */
document.addEventListener('DOMContentLoaded', async () => {
  // 加载配置
  await loadConfig();
  
  // 加载日志
  loadLogs();
  
  // 添加事件监听器
  setupEventListeners();
  
  // 添加初始日志
  addLogToUI('扩展已准备就绪，请访问小红书博主主页并点击"筛选文章"按钮', 'info');
});

/**
 * 设置事件监听器
 */
function setupEventListeners() {
  // 筛选文章按钮点击事件
  analyzeBtn.addEventListener('click', async () => {
    const threshold = parseInt(thresholdInput.value) || 1000;
    await startArticleAnalysis(threshold);
  });
  
  // 保存到飞书按钮点击事件
  saveBtn.addEventListener('click', async () => {
    await saveArticlesToFeishu();
  });
  
  // 保存配置按钮点击事件
  saveConfigBtn.addEventListener('click', async () => {
    await saveConfig();
  });
  
  // 日志切换事件
  toggleLogsBtn.addEventListener('click', () => {
    if (logsContainer.style.display === 'none') {
      logsContainer.style.display = 'block';
      addLogToUI('日志面板已展开', 'info');
    } else {
      logsContainer.style.display = 'none';
    }
  });
  
  // 清除日志事件
  clearLogsBtn.addEventListener('click', async () => {
    await clearLogs();
  });
  
  // 选项卡切换事件
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      
      // 更改选项卡样式
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 显示对应内容
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabId}-tab`) {
          content.classList.add('active');
        }
      });
      
      addLogToUI(`切换到${tabId === 'filter' ? '筛选文章' : '飞书设置'}面板`, 'info');
    });
  });
  
  // 监听来自后台的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'analysisResult') {
      // 更新界面显示筛选结果
      handleAnalysisResult(message);
      sendResponse({ status: 'received' });
    } else if (message.action === 'log') {
      // 添加日志
      addLogToUI(message.message, message.level);
      sendResponse({ status: 'received' });
    }
    
    return true;
  });
}

/**
 * 开始文章分析
 * @param {number} threshold - 点赞数阈值
 */
async function startArticleAnalysis(threshold) {
  try {
    // 设置加载状态
    setLoading(true);
    
    // 清空结果列表
    articleList.innerHTML = '<div class="loading">分析中<span>.</span><span>.</span><span>.</span></div>';
    resultCount.textContent = '0';
    saveBtn.disabled = true;
    
    addLogToUI(`开始筛选点赞数超过 ${threshold} 的文章`, 'info');
    
    // 发送消息给后台脚本，开始分析
    chrome.runtime.sendMessage(
      { action: 'startAnalysis', threshold },
      (response) => {
        if (response && response.status === 'started') {
          addLogToUI('分析请求已发送，等待内容脚本处理', 'info');
        } else {
          setLoading(false);
          articleList.innerHTML = '<div class="no-result">分析请求失败，请重试</div>';
          addLogToUI('分析请求失败，请确认当前标签页是小红书博主主页', 'error');
        }
      }
    );
  } catch (error) {
    setLoading(false);
    articleList.innerHTML = '<div class="no-result">发生错误: ' + error.message + '</div>';
    addLogToUI(`文章分析出错: ${error.message}`, 'error');
  }
}

/**
 * 处理分析结果
 * @param {Object} result - 分析结果
 */
function handleAnalysisResult(result) {
  // 停止加载状态
  setLoading(false);
  
  // 保存筛选后的文章
  filteredArticles = result.filteredArticles || [];
  
  // 更新结果计数
  resultCount.textContent = filteredArticles.length;
  
  // 如果没有找到符合条件的文章
  if (filteredArticles.length === 0) {
    articleList.innerHTML = '<div class="no-result">未找到点赞数超过阈值的文章</div>';
    saveBtn.disabled = true;
    addLogToUI(`未找到点赞数超过 ${result.threshold} 的文章`, 'warning');
    return;
  }
  
  // 启用保存按钮
  saveBtn.disabled = false;
  
  // 创建文章列表HTML
  let articlesHTML = '';
  
  filteredArticles.forEach((article, index) => {
    articlesHTML += `
      <div class="article-item">
        <div class="article-title">${article.title}</div>
        <div class="article-meta">
          <span class="article-link">
            <a href="${article.link}" target="_blank" title="${article.link}">查看原文</a>
          </span>
          <span class="article-likes">点赞: ${article.likesText || article.likes}</span>
        </div>
      </div>
    `;
  });
  
  // 更新文章列表
  articleList.innerHTML = articlesHTML;
  
  addLogToUI(`筛选完成，找到 ${filteredArticles.length} 篇符合条件的文章`, 'info');
}

/**
 * 保存文章到飞书
 */
async function saveArticlesToFeishu() {
  try {
    // 检查是否有文章可保存
    if (filteredArticles.length === 0) {
      addLogToUI('没有可保存的文章', 'warning');
      return;
    }
    
    // 设置加载状态
    setLoading(true);
    saveBtn.disabled = true;
    
    // 添加日志
    addLogToUI(`准备保存 ${filteredArticles.length} 篇文章到飞书`, 'info');
    
    // 发送消息给后台脚本，保存到飞书
    chrome.runtime.sendMessage(
      { 
        action: 'saveToFeishu', 
        articles: filteredArticles 
      },
      (response) => {
        setLoading(false);
        
        if (response && response.status === 'success') {
          addLogToUI(`成功保存 ${response.result.savedCount} 篇文章到飞书`, 'info');
          
          // 显示成功提示
          const successMessage = document.createElement('div');
          successMessage.className = 'no-result';
          successMessage.style.color = '#52c41a';
          successMessage.textContent = `已成功保存 ${response.result.savedCount} 篇文章到飞书`;
          
          articleList.innerHTML = '';
          articleList.appendChild(successMessage);
          
          // 清空筛选结果
          filteredArticles = [];
          resultCount.textContent = '0';
        } else {
          addLogToUI(`保存到飞书失败: ${response.error || '未知错误'}`, 'error');
          saveBtn.disabled = false;
        }
      }
    );
  } catch (error) {
    setLoading(false);
    saveBtn.disabled = false;
    addLogToUI(`保存到飞书出错: ${error.message}`, 'error');
  }
}

/**
 * 加载配置
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'getConfig' },
      (response) => {
        if (response) {
          // 设置点赞阈值输入框
          thresholdInput.value = response.likeThreshold || 1000;
          
          // 设置飞书配置输入框
          if (response.feishuConfig) {
            appIdInput.value = response.feishuConfig.appId || '';
            appSecretInput.value = response.feishuConfig.appSecret || '';
            baseIdInput.value = response.feishuConfig.baseId || '';
            tableIdInput.value = response.feishuConfig.tableId || '';
          }
        }
        
        resolve();
      }
    );
  });
}

/**
 * 保存配置
 */
async function saveConfig() {
  try {
    const config = {
      likeThreshold: parseInt(thresholdInput.value) || 1000,
      feishuConfig: {
        appId: appIdInput.value,
        appSecret: appSecretInput.value,
        baseId: baseIdInput.value,
        tableId: tableIdInput.value
      }
    };
    
    // 验证配置是否完整
    if (!config.feishuConfig.appId || !config.feishuConfig.appSecret ||
        !config.feishuConfig.baseId || !config.feishuConfig.tableId) {
      addLogToUI('飞书配置不完整，请填写所有字段', 'warning');
      return;
    }
    
    // 发送消息保存配置
    chrome.runtime.sendMessage(
      { 
        action: 'saveConfig', 
        config 
      },
      (response) => {
        if (response && response.status === 'success') {
          addLogToUI('配置已保存', 'info');
          
          // 切换回筛选面板
          tabs[0].click();
        } else {
          addLogToUI('保存配置失败', 'error');
        }
      }
    );
  } catch (error) {
    addLogToUI(`保存配置出错: ${error.message}`, 'error');
  }
}

/**
 * 加载日志
 */
function loadLogs() {
  chrome.runtime.sendMessage(
    { action: 'getLogs' },
    (response) => {
      if (response && response.logs) {
        response.logs.forEach(log => {
          addLogToUI(log.message, log.level, log.timestamp);
        });
      }
    }
  );
}

/**
 * 清除日志
 */
async function clearLogs() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'clearLogs' },
      (response) => {
        if (response && response.status === 'success') {
          logsContainer.innerHTML = '';
          addLogToUI('日志已清除', 'info');
        }
        resolve();
      }
    );
  });
}

/**
 * 添加日志到UI
 * @param {string} message - 日志消息
 * @param {string} level - 日志级别 (info, warning, error)
 * @param {string} timestamp - 时间戳，如果不提供则使用当前时间
 */
function addLogToUI(message, level = 'info', timestamp = null) {
  const logItem = document.createElement('div');
  logItem.className = 'log-item';
  
  const time = timestamp ? new Date(timestamp) : new Date();
  const timeStr = time.toLocaleTimeString();
  
  logItem.innerHTML = `
    <span class="log-timestamp">[${timeStr}]</span>
    <span class="log-message log-level-${level}">${message}</span>
  `;
  
  logsContainer.prepend(logItem);
}

/**
 * 设置加载状态
 * @param {boolean} loading - 是否正在加载
 */
function setLoading(loading) {
  isLoading = loading;
  
  // 禁用按钮
  analyzeBtn.disabled = loading;
  
  // 改变按钮文本
  analyzeBtn.textContent = loading ? '分析中...' : '筛选文章';
}
