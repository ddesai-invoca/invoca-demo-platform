console.log('Cookie scripts initializing');
        
        const rawCode = ``
        
        const t = document.createElement('template')
        t.innerHTML = rawCode

        for (const el of t.content.children) {
            const newScript = document.createElement('script')
            for (const attr of el.attributes) {
                newScript.setAttribute(attr.name, attr.value)
            }
            newScript.textContent = el.textContent
            
            document.head.appendChild(newScript)
        }
        console.log('Cookie scripts initialized! ✅');