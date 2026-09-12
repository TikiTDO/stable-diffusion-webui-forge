function setupSettingsUI() {
    var settings = gradioApp().getElementById('settings');
    var wrapper = settings?.querySelector(':scope > .tab-wrapper');
    var pageButtons = wrapper?.querySelector('[role="tablist"]');

    if (!settings || !wrapper || !pageButtons || wrapper.dataset.settingsUiReady) return;

    var tools = document.createElement('div');
    tools.className = 'settings-tools';

    var search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filter current page';
    search.className = 'settings-search';
    search.setAttribute('aria-label', 'Filter current settings page');

    tools.append(search);
    wrapper.insertBefore(tools, wrapper.firstChild);
    wrapper.dataset.settingsUiReady = 'true';

    onEdit('settingsSearch', search, 250, function() {
        var searchText = (search.value || '').trim().toLowerCase();

        gradioApp().querySelectorAll('#settings > .tabitem:not([style*="display: none"]) div[id^=column_settings_] > *').forEach(function(elem) {
            var visible = elem.textContent.trim().toLowerCase().includes(searchText);
            elem.style.display = visible ? '' : 'none';
        });
    });

    pageButtons.addEventListener('click', function() {
        search.value = '';
        search.dispatchEvent(new Event('input', {bubbles: true}));
    });
}

onUiLoaded(setupSettingsUI);
onAfterUiUpdate(setupSettingsUI);


function addSettingsCategories() {
    if (!Array.isArray(opts._categories)) return;

    var pageButtons = gradioApp().querySelector('#settings > .tab-wrapper > [role="tablist"]');
    if (!pageButtons) return;

    var sectionMap = {};
    pageButtons.querySelectorAll(':scope > button').forEach(function(button) {
        sectionMap[button.textContent.trim()] ??= button;
    });

    opts._categories.forEach(function(x) {
        var section = localization[x[0]] ?? x[0];
        var category = localization[x[1]] ?? x[1];
        var sectionElem = sectionMap[section];
        if (!sectionElem || sectionElem.dataset.settingsCategoryReady) return;

        var heading = document.createElement('span');
        heading.textContent = category;
        heading.className = 'settings-category';

        pageButtons.insertBefore(heading, sectionElem);
        sectionElem.dataset.settingsCategoryReady = 'true';
    });
}

onOptionsChanged(addSettingsCategories);
onAfterUiUpdate(addSettingsCategories);
