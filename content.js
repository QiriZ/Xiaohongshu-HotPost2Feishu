// 小红书文章分析器
console.log("小红书文章分析器已加载");

// 监听来自扩展后台的消息
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  // 添加详细的日志以跟踪消息流
  console.log("内容脚本收到消息:", message);
  
  if (message && message.action === "analyzeArticles") {
    var threshold = message.threshold || 1000;
    console.log("开始分析文章，阈值:", threshold);
    
    try {
      // 确保在异步操作中正确处理消息
      analyzeArticles(threshold)
        .then(function(result) {
          console.log("分析完成，结果:", result);
          // 确保在发送响应前检查连接是否仍然有效
          if (chrome.runtime.lastError) {
            console.error("发送响应时出错:", chrome.runtime.lastError);
          } else {
            sendResponse(result);
          }
        })
        .catch(function(error) {
          console.error("分析文章出错:", error);
          // 同样检查错误
          if (chrome.runtime.lastError) {
            console.error("发送错误响应时出错:", chrome.runtime.lastError);
          } else {
            sendResponse({error: error.message});
          }
        });
      
      // 返回true表示将异步发送响应
      return true;
    } catch (error) {
      console.error("执行分析时异常:", error);
      sendResponse({error: "执行分析时发生异常: " + error.message});
      return true;
    }
  } else {
    console.log("收到未知消息或消息格式不正确");
  }
});

// 分析文章主函数
async function analyzeArticles(likeThreshold) {
  try {
    sendLog("开始分析小红书文章");
    console.log("当前页面URL:", window.location.href);
    
    // 检查是否是小红书用户主页
    let isUserProfile = window.location.href.includes("/user/profile/");
    if (isUserProfile) {
      console.log("检测到小红书用户个人主页");
      sendLog("检测到小红书用户个人主页，正在等待内容加载...");
      
      // 在用户主页上，先等待内容加载并滚动页面
      await waitForContentAndScroll();
    } else {
      // 普通页面只等待2秒
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    var articles = findArticleElements(isUserProfile);
    
    if (!articles || articles.length === 0) {
      sendLog("未找到文章元素", "warning");
      return {success: false, error: "未找到文章元素"};
    }
    
    sendLog("找到 " + articles.length + " 个文章元素");
    
    var processedArticles = [];
    for (var i = 0; i < articles.length; i++) {
      try {
        var article = articles[i];
        var title = extractTitle(article);
        var link = extractLink(article);
        var likesText = extractLikes(article);
        var likes = parseLikeCount(likesText);
        
        if (title && link && likes !== null) {
          processedArticles.push({
            title: title,
            link: link,
            likes: likes,
            likesText: likesText
          });
        }
      } catch (error) {
        console.error("处理文章元素出错:", error);
      }
    }
    
    sendLog("成功处理 " + processedArticles.length + " 篇文章");
    
    var filteredArticles = [];
    for (var i = 0; i < processedArticles.length; i++) {
      if (processedArticles[i].likes >= likeThreshold) {
        filteredArticles.push(processedArticles[i]);
      }
    }
    
    sendLog("筛选出 " + filteredArticles.length + " 篇点赞数超过 " + likeThreshold + " 的文章");
    
    // 发送消息到background.js
    chrome.runtime.sendMessage({
      action: "analysisResult",
      allArticles: processedArticles,
      filteredArticles: filteredArticles,
      threshold: likeThreshold
    });
    
    // 返回结果，但不包含文章数据
    // 数据已通过消息发送，这里只返回状态信息
    return {
      success: true,
      message: "分析完成，结果已通过消息发送"
    };
    
  } catch (error) {
    sendLog("分析文章出错: " + error.message, "error");
    throw error;
  }
}

// 等待内容加载并滚动页面
async function waitForContentAndScroll() {
  // 等待内容加载
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // 滚动页面
  var scrollHeight = document.body.scrollHeight;
  var clientHeight = document.body.clientHeight;
  var scrollStep = clientHeight / 5;
  for (var i = 0; i < 5; i++) {
    window.scrollTo(0, scrollStep * (i + 1));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// 查找文章元素
function findArticleElements(isUserProfile) {
  // 调试信息：记录当前URL
  console.log("当前页面URL:", window.location.href);
  
  // 如果是用户主页，使用专门的逻辑
  if (isUserProfile) {
    return findUserProfileArticles();
  }
  
  // 针对首页和发现页的选择器
  var selectors = [
    // 原有选择器
    ".note-item, .feed-item",
    ".content-item, .note-card",
    "article, .post-item, .feed-card",
    ".explore-feed a[href*=\"xhslink.com\"], a[href*=\"/explore/\"]",
    
    // 新增针对首页和发现页的选择器
    ".cover-item",  // 截图中似乎是这种结构
    ".feed-card",
    ".note-card",
    "[data-v-\\w+].card", // Vue框架生成的卡片
    ".homefeed-card",
    ".card-container",
    ".card-wrap",
    
    // 更通用的选择器
    "a[href*=\"/explore/\"]",
    "div[data-note-id]", 
    "[class*=\"note\"][class*=\"item\"]",
    "[class*=\"feed\"][class*=\"item\"]",
    "img[class*=\"cover\"]", // 通过图片找到父级卡片
    "[class*=\"card\"]" // 最通用的卡片选择器
  ];
  
  // 针对个人主页的选择器
  if (isUserProfile) {
    selectors.push(
      ".note-list .note-item",
      ".note-list .note-card",
      ".note-list article",
      ".note-list .post-item",
      ".note-list .feed-card"
    );
  }
  
  for (var i = 0; i < selectors.length; i++) {
    try {
      var elements = document.querySelectorAll(selectors[i]);
      if (elements && elements.length > 0) {
        sendLog("使用选择器 \"" + selectors[i] + "\" 找到 " + elements.length + " 个文章元素");
        return Array.from(elements);
      }
    } catch (error) {
      console.error("选择器错误:", error);
    }
  }
  
  // 尝试通过图片找到文章
  try {
    var images = document.querySelectorAll("img[class*=\"cover\"], img[class*=\"note\"], img[class*=\"feed\"]");
    if (images && images.length > 0) {
      sendLog("通过图片找到 " + images.length + " 个可能的文章元素");
      
      // 获取图片的父元素作为文章容器
      var articleCandidates = new Set();
      for (var i = 0; i < images.length; i++) {
        var img = images[i];
        // 向上找3层父元素
        var parent = img.parentElement;
        for (var j = 0; j < 3 && parent; j++) {
          articleCandidates.add(parent);
          parent = parent.parentElement;
        }
      }
      
      return Array.from(articleCandidates);
    }
  } catch (error) {
    console.error("图片查找错误:", error);
  }
  
  // 尝试通过检测页面上的类来找出可能的文章元素
  try {
    var allElements = document.querySelectorAll("*");
    var classNameSet = new Set();
    
    // 收集页面上所有的class名称
    for (var i = 0; i < allElements.length; i++) {
      var classes = allElements[i].className.split(" ");
      for (var j = 0; j < classes.length; j++) {
        if (classes[j]) classNameSet.add(classes[j]);
      }
    }
    
    // 查找可能的文章相关的class
    var possibleArticleClasses = [];
    classNameSet.forEach(function(className) {
      if (className.indexOf("note") > -1 || 
          className.indexOf("feed") > -1 || 
          className.indexOf("card") > -1 || 
          className.indexOf("item") > -1 || 
          className.indexOf("post") > -1 || 
          className.indexOf("article") > -1) {
        possibleArticleClasses.push("." + className);
      }
    });
    
    // 尝试这些可能的类选择器
    for (var i = 0; i < possibleArticleClasses.length; i++) {
      var elements = document.querySelectorAll(possibleArticleClasses[i]);
      if (elements && elements.length > 0 && elements.length < 100) {
        sendLog("使用动态发现的选择器 \"" + possibleArticleClasses[i] + "\" 找到 " + elements.length + " 个文章元素");
        return Array.from(elements);
      }
    }
  } catch (error) {
    console.error("动态选择器错误:", error);
  }
  
  // 万不得已，尝试提取所有链接
  var allLinks = document.querySelectorAll("a[href*=\"/explore/\"]");
  if (allLinks && allLinks.length > 0) {
    sendLog("直接提取所有包含explore的链接: " + allLinks.length + " 个");
    return Array.from(allLinks);
  }
  
  sendLog("未找到任何文章元素", "warning");
  return [];
}

// 查找用户主页文章
function findUserProfileArticles() {
  console.log("使用专门的用户主页文章查找函数");
  sendLog("正在查找用户主页文章元素...");
  
  // 首先尝试常用的用户主页文章结构
  var profileSelectors = [
    ".user-page .note-list .note-item", 
    ".user-page .notes .note-item",
    ".profile-notes .note-item",
    ".profile-notes .feed-item",
    ".profile-notes .content",
    ".notes-container .note",
    "[data-v-\\w+].note-item", // Vue组件
    "[data-v-\\w+].note-card"  // 另一种Vue组件形式
  ];
  
  // 尝试每个选择器
  for (var i = 0; i < profileSelectors.length; i++) {
    try {
      var elements = document.querySelectorAll(profileSelectors[i]);
      if (elements && elements.length > 0) {
        sendLog("在用户主页使用选择器 \"" + profileSelectors[i] + "\" 找到 " + elements.length + " 个文章元素");
        return Array.from(elements);
      }
    } catch (error) {
      console.error("用户主页选择器错误:", error);
    }
  }
  
  // 如果常规选择器失败，尝试分析页面DOM结构
  console.log("常规选择器未找到文章，尝试分析DOM结构");
  
  // 尝试找到包含多个文章的容器
  try {
    // 寻找包含"笔记"或"note"的容器元素
    var containers = [];
    var possibleContainers = document.querySelectorAll("div[class*='note'], div[class*='post'], div[class*='feed'], div[class*='list']");
    
    for (var i = 0; i < possibleContainers.length; i++) {
      var container = possibleContainers[i];
      // 检查容器内是否有链接且链接数量合理（不太少也不太多）
      var links = container.querySelectorAll("a");
      if (links.length >= 3 && links.length <= 100) {
        containers.push(container);
      }
    }
    
    // 如果找到可能的容器，检查其中是否有可能的文章
    if (containers.length > 0) {
      console.log("找到 " + containers.length + " 个可能的文章容器");
      
      // 对于每个可能的容器
      for (var i = 0; i < containers.length; i++) {
        var container = containers[i];
        
        // 寻找直接子元素或隔一层的元素作为可能的文章元素
        var possibleArticles = [];
        var children = container.children;
        
        // 确定可能的文章特征
        for (var j = 0; j < children.length; j++) {
          var child = children[j];
          // 文章元素通常有图片、标题和链接
          var hasLink = child.querySelector("a") !== null;
          var hasImage = child.querySelector("img") !== null;
          var hasText = child.textContent.trim().length > 10;
          
          if ((hasLink && hasImage) || (hasLink && hasText)) {
            possibleArticles.push(child);
          } else {
            // 检查下一层
            var grandChildren = child.children;
            for (var k = 0; k < grandChildren.length; k++) {
              var grandChild = grandChildren[k];
              hasLink = grandChild.querySelector("a") !== null;
              hasImage = grandChild.querySelector("img") !== null;
              hasText = grandChild.textContent.trim().length > 10;
              
              if ((hasLink && hasImage) || (hasLink && hasText)) {
                possibleArticles.push(grandChild);
              }
            }
          }
        }
        
        // 如果找到可能的文章元素，返回它们
        if (possibleArticles.length >= 3) {
          sendLog("通过DOM分析在用户主页找到 " + possibleArticles.length + " 个可能的文章元素");
          return possibleArticles;
        }
      }
    }
  } catch (error) {
    console.error("DOM分析错误:", error);
  }
  
  // 如果上述方法都失败，尝试寻找所有链接元素
  try {
    var links = document.querySelectorAll("a[href*='/explore/']");
    if (links && links.length > 0) {
      sendLog("在用户主页找到 " + links.length + " 个包含'/explore/'的链接");
      
      // 找到链接的父元素，可能是文章容器
      var linkParents = new Set();
      for (var i = 0; i < links.length; i++) {
        var parent = links[i].parentElement;
        if (parent) {
          linkParents.add(parent);
          // 也添加再上一层的父元素
          if (parent.parentElement) {
            linkParents.add(parent.parentElement);
          }
        }
      }
      
      if (linkParents.size > 0) {
        sendLog("收集到 " + linkParents.size + " 个包含链接的容器");
        return Array.from(linkParents);
      }
      
      return Array.from(links);
    }
  } catch (error) {
    console.error("链接查找错误:", error);
  }
  
  // 最后尝试从页面中提取所有可能的笔记链接
  var html = document.documentElement.outerHTML;
  var noteIdMatches = html.match(/note\/([a-zA-Z0-9]{6,})/g) || [];
  if (noteIdMatches.length > 0) {
    sendLog("直接从HTML提取到 " + noteIdMatches.length + " 个笔记ID");
    
    // 创建虚拟元素来保存这些链接
    var virtualElements = [];
    for (var i = 0; i < noteIdMatches.length; i++) {
      var noteId = noteIdMatches[i].replace("note/", "");
      var virtualElement = document.createElement("div");
      virtualElement.dataset.noteId = noteId;
      virtualElement.innerHTML = "<a href='https://www.xiaohongshu.com/explore/" + noteId + "'>虚拟文章 " + (i+1) + "</a>";
      virtualElements.push(virtualElement);
    }
    
    return virtualElements;
  }
  
  sendLog("在用户主页未找到任何文章元素", "warning");
  return [];
}

// 提取标题
function extractTitle(article) {
  var selectors = [
    ".title, .note-title, h1, h2, h3",
    "[class*=\"title\"], [class*=\"Title\"]",
    ".content p, .desc, .description"
  ];
  
  for (var i = 0; i < selectors.length; i++) {
    var titleElement = article.querySelector(selectors[i]);
    if (titleElement && titleElement.textContent) {
      var title = titleElement.textContent.trim();
      if (title.length > 0) {
        return title;
      }
    }
  }
  
  var image = article.querySelector("img");
  if (image && image.alt && image.alt.length > 5) {
    return image.alt.trim();
  }
  
  var text = article.textContent.trim();
  if (text && text.length > 0 && text.length < 100) {
    return text;
  }
  
  return null;
}

// 提取链接
function extractLink(article) {
  try {
    // 记录调试信息
    console.log("尝试从元素提取链接:", article.tagName, article.className);
    
    // 第一种情况：元素本身是链接
    if (article.tagName === "A" && article.href) {
      console.log("元素本身是链接:", article.href);
      return processUrl(article.href);
    }
    
    // 第二种情况：查找子元素中的链接
    var links = article.querySelectorAll("a");
    console.log("找到子链接数量:", links.length);
    
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var href = link.href || "";
      
      // 记录每个链接
      console.log("子链接" + i + ":", href);
      
      if (href.indexOf("/explore/") > -1 || 
          href.indexOf("xhslink.com") > -1 || 
          href.indexOf("xiaohongshu.com") > -1) {
        console.log("找到有效链接:", href);
        return processUrl(href);
      }
    }
    
    // 第三种情况：检查data属性
    if (article.dataset) {
      console.log("检查data属性:", Object.keys(article.dataset).join(", "));
      
      // 常见的数据属性名
      var possibleDataAttrs = [
        "noteId", "note-id", "id", "itemid", "item-id", 
        "link", "href", "url", "target"
      ];
      
      for (var i = 0; i < possibleDataAttrs.length; i++) {
        var attrName = possibleDataAttrs[i];
        if (article.dataset[attrName]) {
          var value = article.dataset[attrName];
          console.log("找到data属性:", attrName, "=", value);
          
          // 如果是ID，转换为完整URL
          if (attrName.indexOf("id") > -1 && /^[a-zA-Z0-9]+$/.test(value)) {
            return "https://www.xiaohongshu.com/explore/" + value;
          }
          
          // 如果是URL
          if (value.indexOf("http") === 0 || value.indexOf("/") === 0) {
            return processUrl(value);
          }
        }
      }
    }
    
    // 第四种情况：检查onclick事件
    var onclickAttr = article.getAttribute("onclick") || "";
    if (onclickAttr) {
      console.log("检查onclick:", onclickAttr);
      
      // 尝试从onclick中提取链接或ID
      var idMatch = /['"]([a-zA-Z0-9]{6,})['"]/.exec(onclickAttr);
      if (idMatch && idMatch[1]) {
        return "https://www.xiaohongshu.com/explore/" + idMatch[1];
      }
      
      var urlMatch = /(https?:\/\/[^'"]+)/.exec(onclickAttr);
      if (urlMatch && urlMatch[1]) {
        return processUrl(urlMatch[1]);
      }
    }
    
    // 第五种情况：从HTML内容中提取
    var html = article.outerHTML || "";
    console.log("分析HTML内容 (前100字符):", html.substring(0, 100));
    
    // 查找笔记ID
    var noteIdRegexes = [
      /note\/([a-zA-Z0-9]{6,})/, 
      /explore\/([a-zA-Z0-9]{6,})/, 
      /data-note-id=["']([a-zA-Z0-9]{6,})["']/
    ];
    
    for (var i = 0; i < noteIdRegexes.length; i++) {
      var match = noteIdRegexes[i].exec(html);
      if (match && match[1]) {
        console.log("从HTML提取到ID:", match[1]);
        return "https://www.xiaohongshu.com/explore/" + match[1];
      }
    }
    
    // 最后尝试：直接查找任何可能的URL
    var urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
    var urls = html.match(urlRegex) || [];
    
    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      if (url.indexOf("xiaohongshu.com") > -1 || url.indexOf("xhslink.com") > -1) {
        console.log("从HTML提取到URL:", url);
        return processUrl(url);
      }
    }
    
    // 如果依然找不到
    console.log("无法从元素提取链接");
    return null;
  } catch (error) {
    console.error("提取链接错误:", error);
    return null;
  }
}

// 处理URL
function processUrl(url) {
  if (!url) {
    return null;
  }
  
  if (url.charAt(0) === "/") {
    return "https://www.xiaohongshu.com" + url;
  }
  
  return url;
}

// 提取点赞数
function extractLikes(article) {
  var selectors = [
    ".like-count, .likes, .like-num, [class*=\"like\"]",
    ".interactions span, .count span, .statistics span"
  ];
  
  for (var i = 0; i < selectors.length; i++) {
    var elements = article.querySelectorAll(selectors[i]);
    for (var j = 0; j < elements.length; j++) {
      var element = elements[j];
      var text = element.textContent.trim();
      if (/[0-9]/.test(text)) {
        return text;
      }
    }
  }
  
  var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  var node;
  while (node = walker.nextNode()) {
    var text = node.textContent.trim();
    if (text && 
        (text.indexOf("赞") >= 0 || text.indexOf("like") >= 0 || text.indexOf("❤") >= 0) && 
        /[0-9]/.test(text)) {
      return text;
    }
  }
  
  return null;
}

// 解析点赞数
function parseLikeCount(likesText) {
  if (!likesText) {
    return null;
  }
  
  var cleanText = "";
  for (var i = 0; i < likesText.length; i++) {
    var char = likesText.charAt(i);
    if ((char >= "0" && char <= "9") || char === ".") {
      cleanText += char;
    }
  }
  
  if (!cleanText) {
    return null;
  }
  
  var count = parseFloat(cleanText);
  
  if (likesText.indexOf("万") >= 0 || likesText.indexOf("w") >= 0 || likesText.indexOf("W") >= 0) {
    count *= 10000;
  } else if (likesText.indexOf("k") >= 0 || likesText.indexOf("K") >= 0) {
    count *= 1000;
  }
  
  return Math.round(count);
}

// 发送日志
function sendLog(message, level) {
  level = level || "info";
  
  chrome.runtime.sendMessage({
    action: "log",
    message: message,
    level: level
  });
  
  console.log("[" + level.toUpperCase() + "] " + message);
}
