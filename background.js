/**
 * 小红书爆款文章筛选与飞书保存 - 后台服务工作线程
 * 主要功能：
 * 1. 处理扩展图标点击事件，打开侧边栏
 * 2. 与内容脚本(content.js)通信
 * 3. 管理扩展的状态和配置
 */

// 当扩展安装或更新时初始化配置
chrome.runtime.onInstalled.addListener(() => {
  // 设置默认配置
  chrome.storage.local.set({
    likeThreshold: 1000,
    feishuConfig: {
      appId: '【您的飞书ID】',
      appSecret: '【您的应用密钥】',
      baseId: '【多维表格BaseID】',
      tableId: '【表格ID】'
    },
    logEntries: []
  });
  
  console.log('扩展已安装，默认配置已设置');
});

// 处理扩展图标点击事件
chrome.action.onClicked.addListener((tab) => {
  // 确保只在小红书网站上启用功能
  if (tab.url && tab.url.includes('xiaohongshu.com')) {
    // 打开侧边栏
    chrome.sidePanel.open({ tabId: tab.id });
    
    // 记录日志
    addLogEntry('扩展已打开，准备分析小红书文章');
  } else {
    // 如果不是小红书网站，显示提示
    chrome.action.setTitle({
      tabId: tab.id,
      title: '此扩展仅适用于小红书网站'
    });
  }
});

// 监听来自内容脚本和侧边栏的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 根据消息类型处理不同的请求
  switch (message.action) {
    case 'startAnalysis':
      // 向内容脚本发送开始分析的命令
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          // 添加错误处理
          try {
            // 先检查标签页是否存在
            chrome.tabs.sendMessage(
              tabs[0].id, 
              { action: 'analyzeArticles', threshold: message.threshold },
              // 添加回调以捕获可能的连接错误
              (response) => {
                if (chrome.runtime.lastError) {
                  console.error("发送消息错误:", chrome.runtime.lastError);
                  addLogEntry(`无法连接到内容脚本: ${chrome.runtime.lastError.message}`, 'error');
                  sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
                } else {
                  addLogEntry(`开始分析文章，点赞阈值: ${message.threshold}`);
                  // 如果收到响应，将其转发
                  if (response) {
                    sendResponse(response);
                  }
                }
              }
            );
          } catch (error) {
            console.error("发送消息异常:", error);
            addLogEntry(`发送消息异常: ${error.message}`, 'error');
            sendResponse({ status: 'error', error: error.message });
          }
        } else {
          addLogEntry("找不到活动标签页", 'error');
          sendResponse({ status: 'error', error: "找不到活动标签页" });
        }
      });
      // 返回true表示将异步发送响应
      return true;
    
    case 'saveToFeishu':
      // 记录日志
      addLogEntry(`准备保存 ${message.articles.length} 篇文章到飞书`);
      
      // 执行飞书保存逻辑，结果通过回调返回
      saveArticlesToFeishu(message.articles)
        .then(result => {
          sendResponse({ status: 'success', result });
        })
        .catch(error => {
          addLogEntry(`保存到飞书失败: ${error.message}`, 'error');
          sendResponse({ status: 'error', error: error.message });
        });
      // 返回true表示将异步发送响应
      return true;
      
    case 'getConfig':
      // 获取配置
      chrome.storage.local.get(['likeThreshold', 'feishuConfig'], (data) => {
        sendResponse({ 
          likeThreshold: data.likeThreshold || 1000,
          feishuConfig: data.feishuConfig || {}
        });
      });
      // 返回true表示将异步发送响应
      return true;
      
    case 'saveConfig':
      // 保存配置
      chrome.storage.local.set({
        likeThreshold: message.config.likeThreshold,
        feishuConfig: message.config.feishuConfig
      }, () => {
        addLogEntry('配置已更新');
        sendResponse({ status: 'success' });
      });
      // 返回true表示将异步发送响应
      return true;
      
    case 'getLogs':
      // 获取日志
      chrome.storage.local.get(['logEntries'], (data) => {
        sendResponse({ logs: data.logEntries || [] });
      });
      // 返回true表示将异步发送响应
      return true;
      
    case 'clearLogs':
      // 清除日志
      chrome.storage.local.set({ logEntries: [] }, () => {
        sendResponse({ status: 'success' });
      });
      // 返回true表示将异步发送响应
      return true;
  }
});

/**
 * 添加日志条目
 * @param {string} message - 日志消息
 * @param {string} level - 日志级别 (info, warning, error)
 */
function addLogEntry(message, level = 'info') {
  chrome.storage.local.get(['logEntries'], (data) => {
    const logs = data.logEntries || [];
    // 添加新日志（最多保存100条）
    logs.unshift({
      timestamp: new Date().toISOString(),
      message,
      level
    });
    
    // 如果日志超过100条，删除旧的
    if (logs.length > 100) {
      logs.pop();
    }
    
    chrome.storage.local.set({ logEntries: logs });
  });
}

/**
 * 保存文章到飞书多维表格
 * @param {Array} articles - 文章数组，每个文章包含title, link, likes
 * @returns {Promise} - 保存结果
 */
async function saveArticlesToFeishu(articles) {
  try {
    // 添加文章去重逻辑
    const uniqueArticles = [];
    const seenLinks = new Set();
    
    for (const article of articles) {
      // 使用链接作为唯一标识
      if (!seenLinks.has(article.link)) {
        seenLinks.add(article.link);
        uniqueArticles.push(article);
      }
    }
    
    // 记录去重情况
    if (uniqueArticles.length < articles.length) {
      addLogEntry(`检测到${articles.length - uniqueArticles.length}篇重复文章，已自动去重`);
    }
    
    // 使用去重后的文章数组
    articles = uniqueArticles;
    
    // 获取飞书API配置
    const config = await new Promise(resolve => {
      chrome.storage.local.get(['feishuConfig'], (data) => {
        resolve(data.feishuConfig);
      });
    });
    
    // 检查配置是否完整
    if (!config || !config.appId || !config.appSecret || !config.baseId || !config.tableId) {
      throw new Error('飞书API配置不完整，请检查设置');
    }
    
    // 获取飞书访问令牌
    const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret
      })
    });
    
    const tokenData = await tokenResponse.json();
    if (!tokenData.tenant_access_token) {
      throw new Error(`获取飞书访问令牌失败: ${tokenData.msg}`);
    }
    
    const token = tokenData.tenant_access_token;
    addLogEntry('成功获取飞书访问令牌');
    
    // 准备飞书数据
    const records = articles.map(article => {
      return {
        fields: {
          // 使用飞书表格中实际存在的字段名
          '标题': article.title,
          '链接': {
            "type": "url",
            "text": article.title,
            "url": article.link
          },
          '点赞数': String(article.likes)
        }
      };
    });
    
    // 记录一下我们将要发送的数据，方便调试
    console.log("准备发送到飞书的数据:", JSON.stringify(records));
    addLogEntry(`准备发送 ${articles.length} 篇文章数据到飞书`);
    
    // 保存到飞书多维表格
    const saveResponse = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.baseId}/tables/${config.tableId}/records/batch_create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        records: records
      })
    });
    
    const saveResult = await saveResponse.json();
    if (saveResult.code !== 0) {
      throw new Error(`保存到飞书失败: ${saveResult.msg}`);
    }
    
    addLogEntry(`成功保存 ${articles.length} 篇文章到飞书多维表格`);
    return { savedCount: articles.length };
    
  } catch (error) {
    addLogEntry(`保存到飞书出错: ${error.message}`, 'error');
    throw error;
  }
}
